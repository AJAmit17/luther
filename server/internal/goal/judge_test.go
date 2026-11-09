package goal

import "testing"

func TestParse(t *testing.T) {
	for in, want := range map[string]string{
		`{"verdict":"done","reason":"Tests pass."}`:                          "done",
		"```json\n{\"verdict\":\"continue\",\"reason\":\" Add docs \"}\n```": "continue",
		`Here: {"verdict":"blocked","reason":"Needs a key"} ok`:              "blocked",
	} {
		v, err := parse([]byte(in))
		if err != nil || v.Verdict != want {
			t.Errorf("%q: %+v %v", in, v, err)
		}
	}
	for _, bad := range []string{`{"verdict":"maybe","reason":"x"}`, `nope`, `{}`} {
		if _, err := parse([]byte(bad)); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	if v, _ := parse([]byte("```json\n{\"verdict\":\"continue\",\"reason\":\" Add docs \"}\n```")); v.Reason != "Add docs" {
		t.Errorf("reason not trimmed: %q", v.Reason)
	}
}
