package cli

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestPluginHelpStatesSafeModeBoundaries(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := runPlugin(context.Background(), []string{"--help"}, &stdout, &stderr); code != ExitSuccess {
		t.Fatalf("exit=%d stderr=%s", code, stderr.String())
	}
	text := stdout.String()
	for _, phrase := range []string{"disabling and removal remain available", "enable and invoke are refused", "--safe-mode=false cannot override"} {
		if !strings.Contains(text, phrase) {
			t.Fatalf("help missing %q", phrase)
		}
	}
}
