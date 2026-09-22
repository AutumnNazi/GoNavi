package app

import (
	"context"
	"errors"
	"strings"
)

// MigrateLegacyApplicationShortcuts restores packaged icons without applying a saved runtime icon.
// It is a package function so it is not exposed through the Wails bridge.
func MigrateLegacyApplicationShortcuts(a *App) error {
	if a == nil {
		return errors.New("application is unavailable")
	}
	configDir := strings.TrimSpace(a.configDir)
	if configDir == "" {
		configDir = resolveAppConfigDir()
	}
	return migrateLegacyWindowsApplicationShortcuts(configDir)
}

// InitializePersistedNativeBrandIcon applies the last selected desktop icon
// before the first Wails window is shown. It is intentionally a package
// function so it is not exposed through the reflective Wails bridge.
func InitializePersistedNativeBrandIcon(a *App, ctx context.Context) error {
	if a == nil {
		return errors.New("application is unavailable")
	}

	// The WebView can call SetApplicationBrandIcon while OnStartup is still
	// restoring the persisted icon. Publish the runtime context first, then use
	// the same lock as the Wails method so both updates run in a defined order.
	a.ctx = ctx
	applicationBrandIconMu.Lock()
	defer applicationBrandIconMu.Unlock()

	configDir := strings.TrimSpace(a.configDir)
	if configDir == "" {
		configDir = resolveAppConfigDir()
		a.configDir = configDir
	}
	return applyPersistedWindowsApplicationIcon(ctx, configDir)
}
