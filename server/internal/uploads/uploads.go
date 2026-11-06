// Package uploads: attachments from the phone. POST /uploads?name= with the raw
// file as the body (≤ 25 MB) saves it under ~/.luther/uploads and answers its
// path; the next send names that path, and the agent runtime passes images as
// images and other files as paths to read. Week-old uploads are swept.
package uploads

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/httpx"
	"github.com/AJAmit17/luther/server/internal/text"
)

const maxSize = 25 << 20

var unsafe = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func Dir() string { return filepath.Join(config.Dir(), "uploads") }

// Valid: p is a file this package saved (sends may only name those).
func Valid(p string) bool {
	return strings.HasPrefix(filepath.Clean(p), Dir()+string(filepath.Separator))
}

// IsImage: sent to the agent as an image rather than a path.
func IsImage(p string) bool {
	switch strings.ToLower(filepath.Ext(p)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp":
		return true
	}
	return false
}

// MediaType of an image for the agents' image inputs.
func MediaType(p string) string {
	switch strings.ToLower(filepath.Ext(p)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	}
	return "image/png"
}

// ForAgent: an uploaded image as the agents take it. A big one (phone
// screenshots are often several MB of PNG; the API takes at most 5 MB) is
// scaled down to 1568 px on its long side, which models use at most anyway,
// and re-encoded as JPEG. ok is false for files to pass by path instead.
func ForAgent(p string) (data []byte, mediaType string, ok bool) {
	b, err := os.ReadFile(p)
	if err != nil || !IsImage(p) {
		return nil, "", false
	}
	if len(b) <= 3<<20 {
		return b, MediaType(p), true
	}
	img, _, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, "", false
	}
	var out bytes.Buffer
	if jpeg.Encode(&out, shrink(img, 1568), &jpeg.Options{Quality: 85}) != nil || out.Len() > 5<<20 {
		return nil, "", false
	}
	return out.Bytes(), "image/jpeg", true
}

// shrink scales img so its long side is at most max, averaging each source
// box (good enough for screenshots and photos; stdlib only).
func shrink(img image.Image, max int) image.Image {
	r := img.Bounds()
	w, h := r.Dx(), r.Dy()
	if w <= max && h <= max {
		return img
	}
	nw, nh := max, h*max/w
	if h > w {
		nw, nh = w*max/h, max
	}
	out := image.NewRGBA(image.Rect(0, 0, nw, nh))
	for y := 0; y < nh; y++ {
		y0, y1 := r.Min.Y+y*h/nh, r.Min.Y+(y+1)*h/nh
		for x := 0; x < nw; x++ {
			x0, x1 := r.Min.X+x*w/nw, r.Min.X+(x+1)*w/nw
			var sr, sg, sb, n uint64
			for yy := y0; yy < y1; yy++ {
				for xx := x0; xx < x1; xx++ {
					cr, cg, cb, _ := img.At(xx, yy).RGBA()
					sr, sg, sb, n = sr+uint64(cr), sg+uint64(cg), sb+uint64(cb), n+1
				}
			}
			if n == 0 {
				n = 1
			}
			out.Set(x, y, color.RGBA64{uint16(sr / n), uint16(sg / n), uint16(sb / n), 0xffff})
		}
	}
	return out
}

func Routes(mux *http.ServeMux, wrap httpx.Wrap) {
	mux.HandleFunc("POST /uploads", wrap(save))
	mux.HandleFunc("GET /uploads/{name}", wrap(serveImage))
}

var exts = map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}

// Names GET /uploads/{name} answers: images kept from transcripts, and images
// uploaded from the phone (save's "<8 hex>-<name>").
var keptName = regexp.MustCompile(`^(img-[0-9a-f]{16}|[0-9a-f]{8}-[A-Za-z0-9._-]+)\.(?i:png|jpe?g|gif|webp)$`)

// SplitAttached takes "Attached files: …" (what an agent is told about files
// sent by path) off a message, returning the text and the uploaded images it
// named, for the phone to show as pictures. Other files stay in the text.
func SplitAttached(msg string) (string, []string) {
	i := strings.LastIndex(msg, "Attached files: ")
	if i < 0 {
		return msg, nil
	}
	var images, rest []string
	for _, p := range strings.Split(strings.TrimSpace(msg[i+len("Attached files: "):]), ", ") {
		if name := filepath.Base(p); Valid(p) && IsImage(p) && keptName.MatchString(name) {
			images = append(images, name)
		} else {
			rest = append(rest, p)
		}
	}
	text := strings.TrimSpace(msg[:i])
	if len(rest) > 0 {
		text = strings.TrimSpace(text + "\n\nAttached files: " + strings.Join(rest, ", "))
	}
	return text, images
}

// Keep stores an image from a conversation (base64, as the agents' transcripts
// hold it) under a name derived from its bytes, so the phone can show it; "" if
// it isn't an image we keep.
func Keep(mediaType, b64 string) string {
	ext, ok := exts[mediaType]
	if !ok || b64 == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(b64))
	name := "img-" + hex.EncodeToString(sum[:8]) + ext
	p := filepath.Join(Dir(), name)
	if _, err := os.Stat(p); err == nil {
		os.Chtimes(p, time.Now(), time.Now()) // still in use: not swept
		return name
	}
	b, err := base64.StdEncoding.DecodeString(b64)
	if err != nil || os.MkdirAll(Dir(), 0o700) != nil || os.WriteFile(p, b, 0o600) != nil {
		return ""
	}
	return name
}

// serveImage answers a kept image as JSON (base64), so it passes the encrypted
// channel like any other reply.
func serveImage(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !keptName.MatchString(name) {
		http.Error(w, "no such image", http.StatusNotFound)
		return
	}
	b, err := os.ReadFile(filepath.Join(Dir(), name))
	if err != nil {
		http.Error(w, "no such image", http.StatusNotFound)
		return
	}
	httpx.WriteJSON(w, map[string]string{"type": MediaType(name), "data": base64.StdEncoding.EncodeToString(b)})
}

func save(w http.ResponseWriter, r *http.Request) {
	name := unsafe.ReplaceAllString(filepath.Base(text.OrDefault(r.URL.Query().Get("name"), "file")), "_")
	if err := os.MkdirAll(Dir(), 0o700); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	sweep()
	p := filepath.Join(Dir(), text.RandHex(4)+"-"+name)
	f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_, err = io.Copy(f, http.MaxBytesReader(w, r.Body, maxSize))
	f.Close()
	if err != nil {
		os.Remove(p)
		http.Error(w, "upload failed (25 MB max): "+err.Error(), http.StatusRequestEntityTooLarge)
		return
	}
	httpx.WriteJSON(w, map[string]string{"path": p})
}

func sweep() {
	ents, _ := os.ReadDir(Dir())
	for _, e := range ents {
		if info, err := e.Info(); err == nil && time.Since(info.ModTime()) > 7*24*time.Hour {
			os.Remove(filepath.Join(Dir(), e.Name()))
		}
	}
}
