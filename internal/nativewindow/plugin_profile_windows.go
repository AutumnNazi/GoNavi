//go:build windows

package nativewindow

import (
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

func pluginPlatformEnvironment(profile string) []string {
	// WebView2 also reads environment overrides; the parent environment is not
	// inherited, and the sole data-folder override points to this child's profile.
	return []string{"WEBVIEW2_USER_DATA_FOLDER=" + filepath.Join(profile, "webview2")}
}

func configurePluginWebview(app *options.App, profile string) error {
	app.Windows = &windows.Options{WebviewUserDataPath: filepath.Join(profile, "webview2"),
		WindowClassName: "GoNaviPluginWindow", DLLSearchPaths: windows.DLLSearchSystem32 | windows.DLLSearchApplicationDir}
	return nil
}
