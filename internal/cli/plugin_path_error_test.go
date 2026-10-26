package cli

import (
	"archive/zip"
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPluginCheckHidesRejectedPackagePaths(t *testing.T) {
	root := t.TempDir()
	secret := filepath.Join(root, "secret-do-not-display")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	var stdout, stderr bytes.Buffer
	code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", secret}, &stdout, &stderr)
	cancel()
	if code == ExitSuccess || strings.Contains(stdout.String()+stderr.String(), "secret-do-not-display") || strings.Contains(stderr.String(), root) {
		t.Fatalf("missing package leaked: exit=%d stderr=%s", code, stderr.String())
	}
	file := filepath.Join(root, "bad.zip")
	handle, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(handle)
	entry, err := writer.Create("a<b")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = entry.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	handle.Close()
	ctx, cancel = context.WithTimeout(context.Background(), 20*time.Second)
	stdout.Reset()
	stderr.Reset()
	code = runPlugin(ctx, []string{"--root", t.TempDir(), "check", file}, &stdout, &stderr)
	cancel()
	if code == ExitSuccess || strings.Contains(stdout.String()+stderr.String(), "a<b") || strings.Contains(stderr.String(), root) {
		t.Fatalf("forbidden name leaked: exit=%d stderr=%s", code, stderr.String())
	}
	ctx, cancel = context.WithTimeout(context.Background(), 20*time.Second)
	stdout.Reset()
	stderr.Reset()
	code = runPlugin(ctx, []string{"--root", t.TempDir(), "install", "--digest", strings.Repeat("ab", 32), "--trust", secret}, &stdout, &stderr)
	cancel()
	if code == ExitSuccess || strings.Contains(stdout.String()+stderr.String(), "secret-do-not-display") || strings.Contains(stderr.String(), root) {
		t.Fatalf("install leaked: exit=%d stderr=%s", code, stderr.String())
	}
}
