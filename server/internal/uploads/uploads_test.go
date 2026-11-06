package uploads

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math/rand"
	"os"
	"path/filepath"
	"testing"

	"github.com/AJAmit17/luther/server/internal/paths"
)

// A phone screenshot over the API's limit reaches the agent as a smaller JPEG.
func TestForAgentShrinksBigImages(t *testing.T) {
	paths.Home = t.TempDir()
	img := image.NewRGBA(image.Rect(0, 0, 2400, 1100))
	r := rand.New(rand.NewSource(1))
	for i := range img.Pix {
		img.Pix[i] = byte(r.Intn(256)) // noise: a PNG of it is several MB
	}
	var b bytes.Buffer
	png.Encode(&b, img)
	if b.Len() <= 3<<20 {
		t.Fatalf("fixture too small: %d", b.Len())
	}
	p := filepath.Join(Dir(), "0123abcd-shot.png")
	os.MkdirAll(Dir(), 0o700)
	os.WriteFile(p, b.Bytes(), 0o600)
	data, mt, ok := ForAgent(p)
	if !ok || mt != "image/jpeg" || len(data) > 5<<20 {
		t.Fatalf("ok=%v type=%s size=%d", ok, mt, len(data))
	}
	got, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil || got.Bounds().Dx() != 1568 || got.Bounds().Dy() != 1100*1568/2400 {
		t.Fatalf("decoded %v err %v", got.Bounds(), err)
	}
	// A small one passes untouched.
	small := image.NewRGBA(image.Rect(0, 0, 10, 10))
	small.Set(1, 1, color.White)
	b.Reset()
	png.Encode(&b, small)
	q := filepath.Join(Dir(), "0123abcd-small.png")
	os.WriteFile(q, b.Bytes(), 0o600)
	if data, mt, ok := ForAgent(q); !ok || mt != "image/png" || !bytes.Equal(data, b.Bytes()) {
		t.Fatal("small image changed")
	}
}

func TestSplitAttached(t *testing.T) {
	paths.Home = t.TempDir()
	msg := "What's this?\n\nAttached files: " + filepath.Join(Dir(), "52ef6728-shot.png") + ", " + filepath.Join(Dir(), "aaaa1111-notes.txt")
	text, images := SplitAttached(msg)
	if len(images) != 1 || images[0] != "52ef6728-shot.png" {
		t.Fatalf("images %v", images)
	}
	if text != "What's this?\n\nAttached files: "+filepath.Join(Dir(), "aaaa1111-notes.txt") {
		t.Fatalf("text %q", text)
	}
	if text, images := SplitAttached("plain"); text != "plain" || images != nil {
		t.Fatal("plain text changed")
	}
	// Paths outside the uploads folder are left alone.
	if _, images := SplitAttached("x\n\nAttached files: /etc/passwd.png"); images != nil {
		t.Fatal("outside path taken")
	}
}
