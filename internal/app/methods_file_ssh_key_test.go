package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveFileOpenDialogDirectoryHandlesExtensionlessSSHKeys(t *testing.T) {
	root := t.TempDir()
	sshDir := filepath.Join(root, ".ssh")
	if err := os.MkdirAll(sshDir, 0o700); err != nil {
		t.Fatalf("mkdir .ssh: %v", err)
	}

	keyPath := filepath.Join(sshDir, "id_ed25519")
	if err := os.WriteFile(keyPath, []byte("-----BEGIN OPENSSH PRIVATE KEY-----\n"), 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}

	got := resolveFileOpenDialogDirectory(keyPath, filepath.Join(root, "fallback"))
	want := absDialogPath(sshDir)
	if got != want {
		t.Fatalf("existing extensionless key: got %q, want %q", got, want)
	}

	missingKey := filepath.Join(sshDir, "custom_deploy_key")
	got = resolveFileOpenDialogDirectory(missingKey, filepath.Join(root, "fallback"))
	if got != want {
		t.Fatalf("missing extensionless key: got %q, want %q", got, want)
	}

	got = resolveFileOpenDialogDirectory("", sshDir)
	if got != want {
		t.Fatalf("empty current path falls back to .ssh: got %q, want %q", got, want)
	}

	got = resolveFileOpenDialogDirectory(sshDir, filepath.Join(root, "fallback"))
	if got != want {
		t.Fatalf("directory path kept as-is: got %q, want %q", got, want)
	}
}

func TestSelectSSHKeyFileSourceAllowsExtensionlessKeys(t *testing.T) {
	source, err := os.ReadFile("methods_file.go")
	if err != nil {
		t.Fatalf("read methods_file.go: %v", err)
	}
	text := string(source)

	selectFnStart := strings.Index(text, "func (a *App) SelectSSHKeyFile(")
	if selectFnStart < 0 {
		t.Fatal("SelectSSHKeyFile not found")
	}
	selectFnEnd := strings.Index(text[selectFnStart:], "\nfunc (a *App) ")
	if selectFnEnd < 0 {
		t.Fatal("SelectSSHKeyFile end not found")
	}
	fn := text[selectFnStart : selectFnStart+selectFnEnd]

	if !strings.Contains(fn, "resolveFileOpenDialogDirectory(currentPath, fallbackDir)") {
		t.Fatal("SelectSSHKeyFile should resolve default directory for extensionless key paths")
	}
	if !strings.Contains(fn, "ShowHiddenFiles:  true") {
		t.Fatal("SelectSSHKeyFile should show hidden files so ~/.ssh keys are visible")
	}
	if strings.Contains(fn, `Pattern:     "*.pem;*.key;*.ppk`) || strings.Contains(fn, "id_rsa*") {
		t.Fatal("SelectSSHKeyFile must not restrict filters to extension-only or id_rsa globs")
	}
	if !strings.Contains(fn, `Pattern:     "*.*"`) {
		t.Fatal("SelectSSHKeyFile should allow all files for extensionless OpenSSH keys")
	}
}
