// Package seal: the phone↔server end-to-end channel's cryptography, so a relay
// in the middle (a Cloudflare tunnel terminates TLS) sees only ciphertext.
//
//	keys:  X25519 static keys; the server's public key reaches the phone in the
//	       pairing QR (never over the network), the phone's in its sealed pair request
//	key:   HKDF-SHA256(X25519(mine, theirs), salt "luther-e2e-v1",
//	       info serverPub ‖ phonePub) → 32 bytes
//	box:   nonce(12, random) ‖ AES-256-GCM(key, nonce, plain, aad)
//
// The aad says what a box is and where it sits ("req", "res:<id>", "ws>:<id>:<n>"…),
// so a box can't be replayed as anything else. app/src/lib/e2e.ts mirrors this;
// seal_test.go's vector pins both.
package seal

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
)

const salt = "luther-e2e-v1"

var b64 = base64.StdEncoding

// NewKey: a fresh X25519 private key, base64.
func NewKey() string {
	k, _ := ecdh.X25519().GenerateKey(rand.Reader)
	return b64.EncodeToString(k.Bytes())
}

// Public: the base64 public key of a base64 private key.
func Public(priv string) (string, error) {
	k, err := parsePriv(priv)
	if err != nil {
		return "", err
	}
	return b64.EncodeToString(k.PublicKey().Bytes()), nil
}

func parsePriv(priv string) (*ecdh.PrivateKey, error) {
	b, err := b64.DecodeString(priv)
	if err != nil {
		return nil, err
	}
	return ecdh.X25519().NewPrivateKey(b)
}

// Shared: the channel key between the server (serverPriv) and a phone (phonePub).
func Shared(serverPriv, phonePub string) ([]byte, error) {
	k, err := parsePriv(serverPriv)
	if err != nil {
		return nil, err
	}
	pb, err := b64.DecodeString(phonePub)
	if err != nil {
		return nil, err
	}
	peer, err := ecdh.X25519().NewPublicKey(pb)
	if err != nil {
		return nil, err
	}
	secret, err := k.ECDH(peer)
	if err != nil {
		return nil, err
	}
	return hkdfKey(secret, append(k.PublicKey().Bytes(), pb...))
}

// Client: the same key from the phone's side (its private key, the server's public).
func Client(phonePriv, serverPub string) ([]byte, error) {
	k, err := parsePriv(phonePriv)
	if err != nil {
		return nil, err
	}
	sb, err := b64.DecodeString(serverPub)
	if err != nil {
		return nil, err
	}
	peer, err := ecdh.X25519().NewPublicKey(sb)
	if err != nil {
		return nil, err
	}
	secret, err := k.ECDH(peer)
	if err != nil {
		return nil, err
	}
	return hkdfKey(secret, append(sb, k.PublicKey().Bytes()...))
}

func gcm(key []byte) cipher.AEAD {
	b, err := aes.NewCipher(key)
	if err != nil {
		panic(err) // keys are always 32 bytes
	}
	g, _ := cipher.NewGCM(b)
	return g
}

// Box seals plain under key, bound to aad.
func Box(key []byte, aad string, plain []byte) []byte {
	nonce := make([]byte, 12)
	rand.Read(nonce)
	return boxWith(key, nonce, aad, plain)
}

func boxWith(key, nonce []byte, aad string, plain []byte) []byte {
	return gcm(key).Seal(nonce, nonce, plain, []byte(aad))
}

var ErrOpen = errors.New("can't decrypt: wrong key, tampered, or replayed out of place")

// Open undoes Box; the aad must match.
func Open(key []byte, aad string, box []byte) ([]byte, error) {
	if len(box) < 12+16 {
		return nil, ErrOpen
	}
	out, err := gcm(key).Open(nil, box[:12], box[12:], []byte(aad))
	if err != nil {
		return nil, ErrOpen
	}
	return out, nil
}

func hkdfKey(secret, info []byte) ([]byte, error) {
	return hkdf.Key(sha256.New, secret, []byte(salt), string(info), 32)
}
