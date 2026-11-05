// Package uploads: attachments from the phone. POST /uploads?name= with the raw
// file as the body (≤ 25 MB) saves it under ~/.luther/uploads and answers its
// path; the next send names that path, and the agent runtime passes images as
// images and other files as paths to read. Week-old uploads are swept.
package uploads

import (
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

func Routes(mux *http.ServeMux, wrap httpx.Wrap) {
	mux.HandleFunc("POST /uploads", wrap(save))
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
