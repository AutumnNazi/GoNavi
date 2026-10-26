package app

import (
	"os"
	"path/filepath"
	"strings"

	"GoNavi-Wails/internal/connection"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// SelectPluginPackageFile opens the native file dialog for a plugin package
// archive. It only returns a host path: inspection still validates the package
// and installation still requires the exact inspected digest.
func (a *App) SelectPluginPackageFile(currentPath string) connection.QueryResult {
	return a.selectPluginPackagePath(currentPath, false)
}

// SelectPluginPackageDirectory opens the native directory dialog for an
// unpacked plugin package. It never reads or executes package contents.
func (a *App) SelectPluginPackageDirectory(currentPath string) connection.QueryResult {
	return a.selectPluginPackagePath(currentPath, true)
}

func (a *App) selectPluginPackagePath(currentPath string, directory bool) connection.QueryResult {
	if a == nil || a.webRuntime {
		return connection.QueryResult{
			Success: false,
			Message: a.appText("plugin.backend.error.desktop_only", nil),
			Data:    map[string]any{"code": "desktop_only"},
		}
	}
	defaultDir := pluginPackageDialogDirectory(currentPath, directory)
	var (
		selection string
		err       error
	)
	if directory {
		selection, err = runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
			Title:            a.appText("plugin.backend.dialog.select_package_directory", nil),
			DefaultDirectory: defaultDir,
		})
	} else {
		selection, err = runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
			Title:            a.appText("plugin.backend.dialog.select_package_file", nil),
			DefaultDirectory: defaultDir,
			Filters: pluginPackageDialogFilters(
				a.appText("plugin.backend.filter.plugin_package", nil),
				a.appText("file.backend.filter.all_files", nil),
			),
		})
	}
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	selection = strings.TrimSpace(selection)
	if selection == "" {
		return connection.QueryResult{
			Success: false,
			Message: a.appText("file.backend.message.dialog_cancelled", nil),
			Data:    map[string]any{"code": "cancelled"},
		}
	}
	if abs, absErr := filepath.Abs(selection); absErr == nil {
		selection = abs
	}
	return connection.QueryResult{Success: true, Data: map[string]interface{}{"path": selection}}
}

// pluginPackageDialogFilters offers the archive formats the package scanner
// accepts plus an explicit all-files entry, because filters can hide a package
// whose extension differs from its actual content.
func pluginPackageDialogFilters(archiveName, allFilesName string) []runtime.FileFilter {
	return []runtime.FileFilter{
		{DisplayName: archiveName, Pattern: "*.zip;*.tgz;*.tar.gz"},
		{DisplayName: allFilesName, Pattern: "*.*"},
	}
}

// pluginPackageDialogDirectory picks the directory the dialog should start in.
// A directory argument keeps its own path, a file argument opens its parent,
// and an empty argument falls back to the home directory.
func pluginPackageDialogDirectory(currentPath string, directory bool) string {
	path := strings.TrimSpace(currentPath)
	if path == "" {
		if home, err := os.UserHomeDir(); err == nil {
			return home
		}
		return ""
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		absolute = path
	}
	info, statErr := os.Stat(absolute)
	if statErr == nil {
		if info.IsDir() {
			return absolute
		}
		return filepath.Dir(absolute)
	}
	if directory && filepath.Ext(absolute) == "" {
		return absolute
	}
	parent := filepath.Dir(absolute)
	if parent != "" && parent != "." && parent != absolute {
		return parent
	}
	return absolute
}
