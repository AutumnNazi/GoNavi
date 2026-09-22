package app

// windowsApplicationUserModelID is the Windows taskbar identity for GoNavi.
// It is the same value written on the MSI shortcuts. Explorer binds a pinned
// button to this ID for the life of the pin. Replacing it with a per-icon ID
// detaches that button: an MSI pin stops grouping with the running window, and
// a portable pin is removed.
const windowsApplicationUserModelID = "Syngnat.GoNavi"

// windowsApplicationUserModelIDForIconPath returns the taskbar identity used
// while iconPath is the active brand icon. The path used to be hashed into the
// ID so Explorer would discard a cached bitmap. That also orphaned pinned
// shortcuts, so every icon keeps the installer identity. Callers still pass
// the active ICO; the bitmap is updated through the shortcut icon and
// WM_SETICON, not through a new ID.
func windowsApplicationUserModelIDForIconPath(iconPath string) string {
	_ = iconPath
	return windowsApplicationUserModelID
}

// windowsApplicationUserModelIDForStartup is fixed before the first window
// exists. It intentionally ignores the persisted icon so a previous per-icon
// identity cannot start the process in a different taskbar group from the pin.
func windowsApplicationUserModelIDForStartup(configDir string) string {
	_ = configDir
	return windowsApplicationUserModelID
}

// windowsBrandShortcutMatchTargetOnlyEnv is "1" unless this executable is the
// MSI install. A portable process may sit next to an MSI pin; it may refresh
// its own shortcut icon, but it must not rewrite the other pin.
func windowsBrandShortcutMatchTargetOnlyEnv(executablePath string) string {
	if resolveUpdateInstallModeForExecutable("windows", executablePath) == updateInstallModeMSI {
		return "0"
	}
	return "1"
}
