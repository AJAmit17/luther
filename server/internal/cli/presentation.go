package cli

import (
	"fmt"
	"io"
	"os"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/charmbracelet/colorprofile"
	"github.com/mdp/qrterminal/v3"
	"golang.org/x/term"
)

type presentation struct {
	out   io.Writer
	tty   bool
	color bool
	width int
}

func newPresentation(out io.Writer, noColor bool) presentation {
	p := presentation{out: out, width: 80}
	if f, ok := out.(*os.File); ok && term.IsTerminal(int(f.Fd())) && os.Getenv("TERM") != "dumb" {
		p.tty = true
		if width, _, err := term.GetSize(int(f.Fd())); err == nil {
			p.width = width
		}
	}
	_, noColorEnv := os.LookupEnv("NO_COLOR")
	p.color = p.tty && !noColor && !noColorEnv
	if p.color {
		p.out = colorprofile.NewWriter(out, os.Environ())
	}
	return p
}

func (p presentation) label(s, color string) string {
	if !p.color {
		return s
	}
	return lipgloss.NewStyle().Foreground(lipgloss.Color(color)).Bold(true).Render(s)
}

func (p presentation) brand() {
	fmt.Fprintf(p.out, "\n  %s  %s\n  Your coding agents. Anywhere.\n\n", p.label("LUTHER", "#F46A07"), protocol.Version)
}

func (p presentation) message(title, detail string) {
	fmt.Fprintln(p.out, p.label(title, "#F46A07"))
	if detail != "" {
		fmt.Fprintln(p.out, "  "+detail)
	}
}

func (p presentation) panel(title string, rows [][2]string) {
	width := 0
	for _, row := range rows {
		width = max(width, len(row[0]))
	}
	lines := []string{p.label(title, "#F46A07"), ""}
	for _, row := range rows {
		lines = append(lines, fmt.Sprintf("%-*s  %s", width, row[0], row[1]))
	}
	text := strings.Join(lines, "\n")
	if p.tty && p.width >= 40 {
		style := lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(1, 2).Width(min(74, p.width-8))
		if p.color {
			style = style.BorderForeground(lipgloss.Color("#F46A07"))
		}
		text = style.Render(text)
	}
	fmt.Fprintln(p.out, text)
}

func (p presentation) check(good bool, what, detail string) {
	mark, color := "OK", "#45A77B"
	if !good {
		mark, color = "CHECK", "#E5A345"
	}
	fmt.Fprintf(p.out, "  %s  %-14s %s\n", p.label(fmt.Sprintf("%-5s", mark), color), what, detail)
}

func (p presentation) qr(payload string) {
	if p.color {
		qrterminal.GenerateHalfBlock(payload, qrterminal.L, p.out)
		return
	}
	qrterminal.GenerateWithConfig(payload, qrterminal.Config{
		Level: qrterminal.L, Writer: p.out, BlackChar: "██", WhiteChar: "  ", QuietZone: 4,
	})
}
