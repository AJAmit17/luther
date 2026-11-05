// Package text: small string helpers shared by every package.
package text

import (
	"crypto/rand"
	"fmt"
	"strings"
	"unicode/utf8"
)

// Clip cuts s to n runes, marking the cut with "…".
func Clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}

// OneLine collapses whitespace and clips to 120 runes: titles, previews, details.
func OneLine(s string) string { return Clip(strings.Join(strings.Fields(s), " "), 120) }

func OrDefault(s, d string) string {
	if strings.TrimSpace(s) == "" {
		return d
	}
	return s
}

func RandHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}

func NewUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
