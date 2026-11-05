// Package httpx: JSON in and out of handlers.
package httpx

import (
	"encoding/json"
	"net/http"
)

// Wrap is the auth middleware every package's Routes receives.
type Wrap func(http.HandlerFunc) http.HandlerFunc

func WriteJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// ReadJSON decodes a ≤1 MB body, answering 400 itself on failure.
func ReadJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v); err != nil {
		http.Error(w, "bad json: "+err.Error(), http.StatusBadRequest)
		return false
	}
	return true
}

func OrEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}
