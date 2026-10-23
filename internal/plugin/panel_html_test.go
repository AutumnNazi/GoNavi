package plugin

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func htmlPanelManifest() Manifest {
	m := basicManifest("example.html-panel")
	m.Permissions = []string{CustomPanelPermission}
	return m
}

func TestCustomPanelHTMLDeclaration(t *testing.T) {
	m := htmlPanelManifest()
	m.Contributes.Panels = []Panel{{ID: "dashboard", Title: "Dashboard", HTML: &HTMLPanel{Source: "<h1>Hello</h1>"}}}
	if err := ValidateManifest(m); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseManifest(encoded)
	if err != nil {
		t.Fatal(err)
	}
	panel := parsed.Contributes.Panels[0]
	if panel.HTML == nil || panel.HTML.Source != "<h1>Hello</h1>" {
		t.Fatalf("custom html panel did not round-trip: %#v", panel)
	}
}

func TestCustomPanelHTMLKeepsMarkupAsInertData(t *testing.T) {
	source := "<!doctype html><script>parent.document.body.innerHTML='pwned'</script><style>body{color:red}</style>"
	m := htmlPanelManifest()
	m.Contributes.Panels = []Panel{{ID: "hostile", Title: "Hostile", HTML: &HTMLPanel{Source: source}}}
	if err := ValidateManifest(m); err != nil {
		t.Fatalf("bounded markup must stay data and never be rejected by content scanning: %v", err)
	}
	encoded, err := json.Marshal(Status{Manifest: m, Digest: strings.Repeat("a", 64), State: StateRunning, InstalledAt: "now"})
	if err != nil {
		t.Fatal(err)
	}
	var status Status
	if err := json.Unmarshal(encoded, &status); err != nil {
		t.Fatal(err)
	}
	if got := status.Manifest.Contributes.Panels[0].HTML.Source; got != source {
		t.Fatalf("host mutated the panel markup: %q", got)
	}
	if !bytes.Contains(encoded, []byte(`"html"`)) {
		t.Fatal("status must carry the panel declaration for the rendering host")
	}
}

func TestCustomPanelHTMLRequiresDeclaredPermission(t *testing.T) {
	m := basicManifest("example.html-panel")
	m.Contributes.Panels = []Panel{{ID: "dashboard", Title: "Dashboard", HTML: &HTMLPanel{Source: "<p>ok</p>"}}}
	if ValidateManifest(m) == nil {
		t.Fatal("custom html panel without ui.html-panel was accepted")
	}
	m.Permissions = []string{"host.log"}
	if ValidateManifest(m) == nil {
		t.Fatal("custom html panel with an unrelated permission was accepted")
	}
}

func TestCustomPanelHTMLRejectsAmbiguousBodies(t *testing.T) {
	m := htmlPanelManifest()
	m.Contributes.Panels = []Panel{{
		ID: "both", Title: "Both",
		Body: UINode{Type: "text", Text: "hello"},
		HTML: &HTMLPanel{Source: "<p>hello</p>"},
	}}
	if err := ValidateManifest(m); err == nil || !strings.Contains(err.Error(), "both") {
		t.Fatalf("panel declaring two bodies was accepted: %v", err)
	}
	m.Contributes.Panels = []Panel{{ID: "empty", Title: "Empty"}}
	if err := ValidateManifest(m); err == nil || !strings.Contains(err.Error(), "no body") {
		t.Fatalf("panel declaring no body was accepted: %v", err)
	}
	m.Contributes.Panels = []Panel{
		{ID: "dup", Title: "First", HTML: &HTMLPanel{Source: "<p>1</p>"}},
		{ID: "dup", Title: "Second", HTML: &HTMLPanel{Source: "<p>2</p>"}},
	}
	if err := ValidateManifest(m); err == nil || !strings.Contains(err.Error(), "duplicate panel") {
		t.Fatalf("duplicate custom html panel id was accepted: %v", err)
	}
}

func TestCustomPanelHTMLTextBounds(t *testing.T) {
	m := htmlPanelManifest()
	m.Contributes.Panels = []Panel{{ID: "size", Title: "Size", HTML: &HTMLPanel{Source: strings.Repeat("a", MaxCustomPanelHTMLBytes)}}}
	if err := ValidateManifest(m); err != nil {
		t.Fatalf("exactly %d bytes must be accepted: %v", MaxCustomPanelHTMLBytes, err)
	}
	m.Contributes.Panels[0].HTML.Source = strings.Repeat("a", MaxCustomPanelHTMLBytes+1)
	if ValidateManifest(m) == nil {
		t.Fatal("custom html panel over the byte limit was accepted")
	}
	wide := strings.Repeat("文", MaxCustomPanelHTMLBytes/3)
	m.Contributes.Panels[0].HTML.Source = wide
	if err := ValidateManifest(m); err != nil {
		t.Fatalf("multibyte markup under the byte limit must be accepted: %v", err)
	}
	m.Contributes.Panels[0].HTML.Source = wide + "文"
	if ValidateManifest(m) == nil {
		t.Fatal("multibyte markup over the byte limit was accepted")
	}
}

func TestCustomPanelHTMLRejectsUnusableText(t *testing.T) {
	cases := map[string]string{
		"empty":         "",
		"whitespace":    "  \n\t ",
		"nul":           "<p>a\x00b</p>",
		"invalid utf-8": "<p>\xff\xfe</p>",
	}
	for name, source := range cases {
		t.Run(name, func(t *testing.T) {
			m := htmlPanelManifest()
			m.Contributes.Panels = []Panel{{ID: "text", Title: "Text", HTML: &HTMLPanel{Source: source}}}
			if ValidateManifest(m) == nil {
				t.Fatalf("unusable custom html %q was accepted", name)
			}
		})
	}
}

func TestParseCustomPanelHTMLStrictFields(t *testing.T) {
	base := `{"schemaVersion":1,"apiVersion":1,"id":"example.html-panel","name":"Fixture","version":"1.0.0","permissions":["ui.html-panel"],"contributes":{"panels":[%s]}}`
	cases := []string{
		`{"id":"p","title":"P","html":{"source":"<p>ok</p>","script":"evil()"}}`,
		`{"id":"p","title":"P","html":{"source":123}}`,
		`{"id":"p","title":"P","html":{"source":"<p>ok</p>"},"command":"evil"}`,
		`{"id":"p","title":"P","html":null}`,
		`{"id":"p","title":"P","body":{"type":"html"}}`,
	}
	for _, panel := range cases {
		raw := []byte(strings.Replace(base, "%s", panel, 1))
		if _, err := ParseManifest(raw); err == nil {
			t.Fatalf("ambiguous or unknown custom html declaration was accepted: %s", panel)
		}
	}
	raw := []byte(strings.Replace(base, "%s", `{"id":"p","title":"P","html":{"source":"<p>ok</p>"}}`, 1))
	if _, err := ParseManifest(raw); err != nil {
		t.Fatalf("strict parse rejected a valid custom html panel: %v", err)
	}
}

func TestDeclarativePanelContractUnchanged(t *testing.T) {
	m := basicManifest("example.declarative")
	m.Contributes.Panels = []Panel{{ID: "main", Title: "Main", Body: UINode{Type: "text", Text: "Hello"}}}
	if err := ValidateManifest(m); err != nil {
		t.Fatalf("declarative-only panel must not require the custom html permission: %v", err)
	}
	m.Contributes.Panels = []Panel{{ID: "main", Title: "Main"}}
	if ValidateManifest(m) == nil {
		t.Fatal("panel without a declarative body was accepted")
	}
}
