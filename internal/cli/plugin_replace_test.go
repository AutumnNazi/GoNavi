package cli

import (
	"strings"
	"testing"
)

func TestPluginReplaceRequiresDigestAndTrust(t *testing.T) {
	for _, args := range [][]string{
		{"replace", "package"},
		{"replace", "--trust", "package"},
		{"replace", "--digest", strings.Repeat("a", 64), "package"},
		{"replace", "--digest", "short", "--trust", "package"},
	} {
		fake := &fakePluginRuntime{}
		code, stdout, stderr, _ := testPluginCLI(t, append([]string{"--root", t.TempDir()}, args...), fake)
		if code == ExitSuccess || len(fake.calls) != 0 || fake.starts != 0 {
			t.Fatalf("%v: exit=%d stdout=%s stderr=%s calls=%v", args, code, stdout, stderr, fake.calls)
		}
	}
}
