package plugin

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var relativeDocLink = regexp.MustCompile(`\]\(<?([^)>\s]+)>?\)`)

// The plugin guides are the developer contract; a renamed or deleted file must not leave dead links.
func TestPluginDocLinksResolve(t *testing.T) {
	directory := filepath.Join("..", "..", "docs", "plugins")
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	links := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		path := filepath.Join(directory, entry.Name())
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		for _, match := range relativeDocLink.FindAllStringSubmatch(string(body), -1) {
			target := match[1]
			if strings.HasPrefix(target, "http://") || strings.HasPrefix(target, "https://") || strings.HasPrefix(target, "mailto:") || strings.HasPrefix(target, "#") {
				continue
			}
			links++
			if _, err := os.Stat(filepath.Join(directory, filepath.FromSlash(strings.SplitN(target, "#", 2)[0]))); err != nil {
				t.Errorf("%s links to a missing file: %s", entry.Name(), target)
			}
		}
	}
	if links < 100 {
		t.Fatalf("found only %d relative links; the scanner probably stopped working", links)
	}
}
