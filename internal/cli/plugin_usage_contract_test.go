package cli

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

// The usage text and the parser are edited separately; this keeps them from drifting apart.
func TestPluginUsageDocumentsEveryAcceptedCommand(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := runPlugin(context.Background(), []string{"--help"}, &stdout, &stderr); code != ExitSuccess {
		t.Fatalf("help: exit=%d stderr=%s", code, stderr.String())
	}
	usage := stdout.String()
	arguments := map[string][]string{
		"list":    {},
		"inspect": {"package"},
		"check":   {"package"},
		"install": {"--digest", strings.Repeat("a", 64), "--trust", "package"},
		"replace": {"--digest", strings.Repeat("a", 64), "--trust", "package"},
		"enable":  {"example.hello"},
		"disable": {"example.hello"},
		"remove":  {"example.hello"},
		"invoke":  {"example.hello", "hello"},
	}
	for command, args := range arguments {
		if !strings.Contains(usage, "  "+command) {
			t.Errorf("%s is accepted by the parser but missing from the usage text", command)
		}
		options, err := parsePluginOptions(append([]string{command}, args...))
		if err != nil && strings.Contains(err.Error(), "unknown plugin command") {
			t.Errorf("%s is documented but rejected by the parser: %v", command, err)
		}
		if err == nil && options.command != command {
			t.Errorf("%s parsed as %q", command, options.command)
		}
	}
	if _, err := parsePluginOptions([]string{"definitely-not-a-command"}); err == nil {
		t.Fatal("parser accepted an unknown command")
	}
}
