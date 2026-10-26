package app

import (
	"os"
	"path/filepath"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestPluginPackageDialogDirectory(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "plugin.zip")
	if err := os.WriteFile(filePath, []byte("pkg"), 0o600); err != nil {
		t.Fatalf("prepare package file: %v", err)
	}
	nested := filepath.Join(root, "nested")
	if err := os.Mkdir(nested, 0o755); err != nil {
		t.Fatalf("prepare package directory: %v", err)
	}

	cases := []struct {
		name      string
		current   string
		directory bool
		want      string
	}{
		{name: "existing directory stays", current: nested, want: nested},
		{name: "existing file opens parent", current: filePath, want: root},
		{name: "missing archive opens parent", current: filepath.Join(root, "later.tgz"), want: root},
		{name: "missing directory path keeps itself", current: filepath.Join(root, "later"), directory: true, want: filepath.Join(root, "later")},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := pluginPackageDialogDirectory(testCase.current, testCase.directory); got != testCase.want {
				t.Fatalf("pluginPackageDialogDirectory(%q) = %q, want %q", testCase.current, got, testCase.want)
			}
		})
	}

	t.Run("empty path falls back to home", func(t *testing.T) {
		home, err := os.UserHomeDir()
		if err != nil {
			t.Skipf("home directory unavailable: %v", err)
		}
		if got := pluginPackageDialogDirectory("", false); got != home {
			t.Fatalf("pluginPackageDialogDirectory(\"\") = %q, want %q", got, home)
		}
	})
}

func TestPluginPackageDialogFiltersPreferArchives(t *testing.T) {
	filters := pluginPackageDialogFilters("Plugin package", "All files")
	if len(filters) != 2 {
		t.Fatalf("filters = %d, want 2", len(filters))
	}
	if filters[0].Pattern != "*.zip;*.tgz;*.tar.gz" {
		t.Fatalf("archive pattern = %q", filters[0].Pattern)
	}
	if filters[1].Pattern != "*.*" {
		t.Fatalf("all-files pattern = %q", filters[1].Pattern)
	}
}

func TestSelectPluginPackageRejectsWebRuntime(t *testing.T) {
	app := &App{webRuntime: true}
	cases := []struct {
		name   string
		result connection.QueryResult
	}{
		{name: "file", result: app.SelectPluginPackageFile("")},
		{name: "directory", result: app.SelectPluginPackageDirectory("")},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if testCase.result.Success {
				t.Fatal("web runtime must not open native plugin package dialogs")
			}
			data, ok := testCase.result.Data.(map[string]any)
			if !ok || data["code"] != "desktop_only" {
				t.Fatalf("data = %#v, want desktop_only code", testCase.result.Data)
			}
		})
	}
}
