package plugin

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectMissingPackageDoesNotEchoPath(t *testing.T) {
	root := t.TempDir()
	secret := filepath.Join(root, "secret-do-not-display")
	_, err := InspectPackage(context.Background(), secret)
	if err == nil || strings.Contains(err.Error(), "secret-do-not-display") || strings.Contains(err.Error(), root) {
		t.Fatal(err)
	}
}
