package plugin

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

var rpcMethodPattern = regexp.MustCompile(`"(plugin\.[a-zA-Z]+|host\.[a-zA-Z]+)"`)

// protocol.md is the public contract for plugin authors: a renamed method must fail here first.
func TestRPCMethodsAreDocumented(t *testing.T) {
	doc, err := os.ReadFile(filepath.Join("..", "..", "docs", "plugins", "protocol.md"))
	if err != nil {
		t.Fatal(err)
	}
	guide := string(doc)
	methods := map[string]bool{"$/cancelRequest": true}
	for _, directory := range []string{".", filepath.Join("..", "..", "sdk", "go")} {
		entries, err := os.ReadDir(directory)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			name := entry.Name()
			if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
				continue
			}
			body, err := os.ReadFile(filepath.Join(directory, name))
			if err != nil {
				t.Fatal(err)
			}
			for _, match := range rpcMethodPattern.FindAllStringSubmatch(string(body), -1) {
				methods[match[1]] = true
			}
		}
	}
	if len(methods) < 8 {
		t.Fatalf("scanned only %d methods; the scanner probably stopped working", len(methods))
	}
	names := make([]string, 0, len(methods))
	for name := range methods {
		names = append(names, name)
	}
	sort.Strings(names)
	var missing []string
	for _, name := range names {
		// The reference table is the authoritative list: prose alone cannot keep a method documented.
		if !strings.Contains(guide, "| `"+name+"` |") {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("undocumented JSON-RPC methods: %v", missing)
	}
}
