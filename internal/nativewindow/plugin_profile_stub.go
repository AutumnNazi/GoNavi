//go:build (!windows && !linux && !darwin) || (darwin && !cgo)

package nativewindow

import (
	"errors"

	"github.com/wailsapp/wails/v2/pkg/options"
)

func pluginPlatformEnvironment(string) []string { return nil }
func configurePluginWebview(*options.App, string) error {
	return errors.New("isolated plugin WebView is unsupported on this build")
}
