package provider

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPinGrokAPIKeyAuthAppendsMissingSection(t *testing.T) {
	got := pinGrokAPIKeyAuth("model = \"grok-4.6\"\n")
	if !strings.Contains(got, "model = \"grok-4.6\"") {
		t.Fatalf("original config was dropped: %s", got)
	}
	if strings.Count(got, `preferred_method = "api_key"`) != 1 {
		t.Fatalf("auth pin = %s", got)
	}
}

func TestPinGrokAPIKeyAuthReplacesExistingMethod(t *testing.T) {
	got := pinGrokAPIKeyAuth("[auth]\npreferred_method = \"oidc\"\n\n[cli]\nfoo = 1\n")
	if strings.Contains(got, "oidc") {
		t.Fatalf("oidc preference remained: %s", got)
	}
	if strings.Count(got, "[auth]") != 1 || strings.Count(got, `preferred_method = "api_key"`) != 1 {
		t.Fatalf("auth section = %s", got)
	}
	if !strings.Contains(got, "foo = 1") {
		t.Fatalf("following section was dropped: %s", got)
	}
}

func TestPrepareGrokCLIAPIKeyHomeDoesNotCopyLogin(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(source, []byte("api_key = \"test-key\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	home, cleanup, err := prepareGrokCLIAPIKeyHome(source)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if _, err := os.Stat(filepath.Join(home, "auth.json")); !os.IsNotExist(err) {
		t.Fatal("isolated home must not carry the OIDC login file")
	}
	body, err := os.ReadFile(filepath.Join(home, "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `preferred_method = "api_key"`) || !strings.Contains(string(body), "test-key") {
		t.Fatalf("isolated config = %s", body)
	}
	info, err := os.Stat(filepath.Join(home, "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("config mode = %o", info.Mode().Perm())
	}
}
