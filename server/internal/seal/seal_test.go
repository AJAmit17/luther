package seal

import (
	"encoding/hex"
	"testing"
)

// Fixed keys and nonce: the same vector is checked in app/src/lib/e2e.test.ts.
const (
	serverPriv = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
	phonePriv  = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8="
	wantKey    = "30ec8d89353d0a9f716695bfc640d133ce1d8d51d37d776c63dad0ef8adbb64a"
	wantBox    = "0000000000000000000000004428631082c07a1445559a3e70a24da739c6075358"
)

func TestVector(t *testing.T) {
	phonePub, err := Public(phonePriv)
	if err != nil {
		t.Fatal(err)
	}
	key, err := Shared(serverPriv, phonePub)
	if err != nil {
		t.Fatal(err)
	}
	// The phone derives the same key from its side.
	serverPub, _ := Public(serverPriv)
	key2 := phoneSide(t, serverPub)
	if hex.EncodeToString(key) != hex.EncodeToString(key2) {
		t.Fatal("sides disagree")
	}
	box := boxWith(key, make([]byte, 12), "req", []byte("hello"))
	t.Logf("phonePub=%s serverPub=%s key=%x box=%x", phonePub, serverPub, key, box)
	if wantKey != "" && hex.EncodeToString(key) != wantKey {
		t.Errorf("key = %x, want %s", key, wantKey)
	}
	if wantBox != "" && hex.EncodeToString(box) != wantBox {
		t.Errorf("box = %x, want %s", box, wantBox)
	}
	plain, err := Open(key, "req", box)
	if err != nil || string(plain) != "hello" {
		t.Fatalf("open: %q %v", plain, err)
	}
	if _, err := Open(key, "res", box); err == nil {
		t.Fatal("opened under the wrong aad")
	}
	box[20] ^= 1
	if _, err := Open(key, "req", box); err == nil {
		t.Fatal("opened a tampered box")
	}
}

func phoneSide(t *testing.T, serverPub string) []byte {
	key, err := Client(phonePriv, serverPub)
	if err != nil {
		t.Fatal(err)
	}
	return key
}
