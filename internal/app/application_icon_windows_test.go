//go:build windows

package app

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeBrandIconWindow struct {
	hwnd uintptr
}

func (w *fakeBrandIconWindow) Handle() uintptr {
	return w.hwnd
}

type fakeBrandIconFrontend struct {
	chromium   *fakeChromium
	mainWindow *fakeBrandIconWindow
}

func TestResolveWailsMainWindowHandleUsesExactFrontendWindow(t *testing.T) {
	const want = uintptr(0x1234)
	ctx := context.WithValue(context.Background(), stringContextKey("frontend"), &fakeBrandIconFrontend{
		chromium:   &fakeChromium{},
		mainWindow: &fakeBrandIconWindow{hwnd: want},
	})

	got, err := resolveWailsMainWindowHandle(ctx)
	if err != nil {
		t.Fatalf("resolve Wails main window handle: %v", err)
	}
	if got != want {
		t.Fatalf("main window handle = %#x, want %#x", got, want)
	}
}

func TestApplyWindowsApplicationIconVerifiesMainWindowReadback(t *testing.T) {
	const (
		hwnd  = uintptr(0x1234)
		small = uintptr(0x2001)
		large = uintptr(0x2002)
	)
	originalSend := windowsApplicationIconSendMessageCall
	originalSetClass := windowsApplicationIconSetClassIcon
	originalSetTaskbarProperties := windowsApplicationIconSetTaskbarProperties
	t.Cleanup(func() {
		windowsApplicationIconSendMessageCall = originalSend
		windowsApplicationIconSetClassIcon = originalSetClass
		windowsApplicationIconSetTaskbarProperties = originalSetTaskbarProperties
	})

	current := map[uintptr]uintptr{}
	var calls [][4]uintptr
	windowsApplicationIconSendMessageCall = func(actualHWND, message, iconType, icon uintptr) uintptr {
		calls = append(calls, [4]uintptr{actualHWND, message, iconType, icon})
		switch message {
		case windowsSetIconMessage:
			current[iconType] = icon
		case windowsGetIconMessage:
			return current[iconType]
		}
		return 0
	}
	windowsApplicationIconSetClassIcon = func(actualHWND uintptr, index int32, icon uintptr) {
		if actualHWND != hwnd {
			t.Fatalf("class icon HWND = %#x, want %#x", actualHWND, hwnd)
		}
		if index != windowsClassIconSmall && index != windowsClassIconLarge {
			t.Fatalf("unexpected class icon index %d", index)
		}
		if icon != small && icon != large {
			t.Fatalf("unexpected class icon handle %#x", icon)
		}
	}
	var taskbarHWND uintptr
	var taskbarIconPath string
	windowsApplicationIconSetTaskbarProperties = func(actualHWND uintptr, iconPath string) error {
		taskbarHWND = actualHWND
		taskbarIconPath = iconPath
		return nil
	}

	const iconPath = `C:\Users\tester\gonavi-brand.ico`
	if err := applyWindowsApplicationIcon(hwnd, iconPath, small, large); err != nil {
		t.Fatalf("apply Windows application icon: %v", err)
	}
	if len(calls) != 4 {
		t.Fatalf("SendMessage call count = %d, want 4: %#v", len(calls), calls)
	}
	if calls[0] != [4]uintptr{hwnd, windowsSetIconMessage, windowsIconSmall, small} {
		t.Fatalf("small icon update = %#v", calls[0])
	}
	if calls[1] != [4]uintptr{hwnd, windowsSetIconMessage, windowsIconBig, large} {
		t.Fatalf("large icon update = %#v", calls[1])
	}
	if taskbarHWND != hwnd || taskbarIconPath != iconPath {
		t.Fatalf("taskbar properties = (%#x, %q), want (%#x, %q)", taskbarHWND, taskbarIconPath, hwnd, iconPath)
	}
}

func TestApplyWindowsApplicationIconRejectsSilentSetFailure(t *testing.T) {
	originalSend := windowsApplicationIconSendMessageCall
	originalSetClass := windowsApplicationIconSetClassIcon
	originalSetTaskbarProperties := windowsApplicationIconSetTaskbarProperties
	t.Cleanup(func() {
		windowsApplicationIconSendMessageCall = originalSend
		windowsApplicationIconSetClassIcon = originalSetClass
		windowsApplicationIconSetTaskbarProperties = originalSetTaskbarProperties
	})
	windowsApplicationIconSendMessageCall = func(_, message, _, _ uintptr) uintptr {
		if message == windowsGetIconMessage {
			return 0
		}
		return 0
	}
	windowsApplicationIconSetClassIcon = func(uintptr, int32, uintptr) {}
	windowsApplicationIconSetTaskbarProperties = func(uintptr, string) error {
		t.Fatal("taskbar properties must not update when icon readback failed")
		return nil
	}

	err := applyWindowsApplicationIcon(0x1234, `C:\brand.ico`, 0x2001, 0x2002)
	if err == nil {
		t.Fatal("expected readback mismatch to fail")
	}
	if got := err.Error(); !containsAll(got, "readback", "small", "large") {
		t.Fatalf("unexpected readback error: %v", err)
	}
}

func TestApplyWindowsApplicationIconReturnsTaskbarPropertyFailure(t *testing.T) {
	originalSend := windowsApplicationIconSendMessageCall
	originalSetClass := windowsApplicationIconSetClassIcon
	originalSetTaskbarProperties := windowsApplicationIconSetTaskbarProperties
	t.Cleanup(func() {
		windowsApplicationIconSendMessageCall = originalSend
		windowsApplicationIconSetClassIcon = originalSetClass
		windowsApplicationIconSetTaskbarProperties = originalSetTaskbarProperties
	})
	windowsApplicationIconSendMessageCall = func(_, message, iconType, icon uintptr) uintptr {
		if message == windowsGetIconMessage {
			if iconType == windowsIconSmall {
				return 0x2001
			}
			return 0x2002
		}
		return icon
	}
	windowsApplicationIconSetClassIcon = func(uintptr, int32, uintptr) {}
	windowsApplicationIconSetTaskbarProperties = func(uintptr, string) error {
		return errors.New("shell rejected taskbar properties")
	}

	err := applyWindowsApplicationIcon(0x1234, `C:\brand.ico`, 0x2001, 0x2002)
	if err == nil || !strings.Contains(err.Error(), "taskbar") {
		t.Fatalf("expected taskbar property error, got %v", err)
	}
}

func containsAll(value string, fragments ...string) bool {
	for _, fragment := range fragments {
		if !strings.Contains(value, fragment) {
			return false
		}
	}
	return true
}

func TestInitializePersistedNativeBrandIconAppliesActiveIcon(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	source.SetNRGBA(0, 0, color.NRGBA{R: 0x22, G: 0x66, B: 0xaa, A: 0xff})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	configDir := t.TempDir()
	iconPath, err := persistWindowsApplicationIcon(encoded.Bytes(), configDir)
	if err != nil {
		t.Fatalf("persist active icon: %v", err)
	}
	if err := activatePersistedWindowsApplicationIcon(iconPath, configDir); err != nil {
		t.Fatalf("activate active icon: %v", err)
	}

	const (
		hwnd  = uintptr(0x1234)
		small = uintptr(0x2001)
		large = uintptr(0x2002)
	)
	ctx := context.WithValue(context.Background(), stringContextKey("frontend"), &fakeBrandIconFrontend{
		chromium:   &fakeChromium{},
		mainWindow: &fakeBrandIconWindow{hwnd: hwnd},
	})
	application := NewAppWithSecretStore(nil)
	application.configDir = configDir

	originalLoad := windowsApplicationIconLoad
	originalDestroy := windowsApplicationIconDestroyCall
	originalSend := windowsApplicationIconSendMessageCall
	originalSetClass := windowsApplicationIconSetClassIcon
	originalSetTaskbarProperties := windowsApplicationIconSetTaskbarProperties
	originalUpdateShortcuts := windowsUpdateCurrentApplicationShortcuts
	originalResolveInstallTarget := updateResolveInstallTarget
	originalVersion := AppVersion
	windowsApplicationIconHandleMu.Lock()
	originalSmallHandle := windowsApplicationIconSmallHandle
	originalLargeHandle := windowsApplicationIconLargeHandle
	windowsApplicationIconSmallHandle = 0
	windowsApplicationIconLargeHandle = 0
	windowsApplicationIconHandleMu.Unlock()
	t.Cleanup(func() {
		windowsApplicationIconLoad = originalLoad
		windowsApplicationIconDestroyCall = originalDestroy
		windowsApplicationIconSendMessageCall = originalSend
		windowsApplicationIconSetClassIcon = originalSetClass
		windowsApplicationIconSetTaskbarProperties = originalSetTaskbarProperties
		windowsUpdateCurrentApplicationShortcuts = originalUpdateShortcuts
		updateResolveInstallTarget = originalResolveInstallTarget
		AppVersion = originalVersion
		windowsApplicationIconHandleMu.Lock()
		windowsApplicationIconSmallHandle = originalSmallHandle
		windowsApplicationIconLargeHandle = originalLargeHandle
		windowsApplicationIconHandleMu.Unlock()
	})

	var loadedSizes []int
	windowsApplicationIconLoad = func(actualPath string, size int) (uintptr, error) {
		if application.ctx != ctx {
			t.Fatal("runtime context was not bound before persisted icon restore")
		}
		if actualPath != iconPath {
			t.Fatalf("loaded icon path = %q, want %q", actualPath, iconPath)
		}
		loadedSizes = append(loadedSizes, size)
		if size == windowsSmallIconPixels {
			return small, nil
		}
		return large, nil
	}
	windowsApplicationIconDestroyCall = func(uintptr) {}
	current := map[uintptr]uintptr{}
	windowsApplicationIconSendMessageCall = func(actualHWND, message, iconType, icon uintptr) uintptr {
		if actualHWND != hwnd {
			t.Fatalf("icon message HWND = %#x, want %#x", actualHWND, hwnd)
		}
		switch message {
		case windowsSetIconMessage:
			current[iconType] = icon
		case windowsGetIconMessage:
			return current[iconType]
		}
		return 0
	}
	windowsApplicationIconSetClassIcon = func(uintptr, int32, uintptr) {}
	var taskbarIconPath string
	var shortcutIconPath string
	shortcutUpdateCount := 0
	var identityEvents []string
	windowsUpdateCurrentApplicationShortcuts = func(actualPath string) error {
		shortcutUpdateCount++
		shortcutIconPath = actualPath
		identityEvents = append(identityEvents, "shortcut")
		return nil
	}
	installDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(installDir, windowsMSIInstallMarker), []byte("MSI"), 0o644); err != nil {
		t.Fatal(err)
	}
	updateResolveInstallTarget = func() string {
		return filepath.Join(installDir, "GoNavi.exe")
	}
	AppVersion = "1.0.0"
	windowsApplicationIconSetTaskbarProperties = func(actualHWND uintptr, actualPath string) error {
		if actualHWND != hwnd {
			t.Fatalf("taskbar HWND = %#x, want %#x", actualHWND, hwnd)
		}
		taskbarIconPath = actualPath
		identityEvents = append(identityEvents, "window")
		return nil
	}

	if err := InitializePersistedNativeBrandIcon(application, ctx); err != nil {
		t.Fatalf("initialize persisted native brand icon: %v", err)
	}
	if len(loadedSizes) != 2 || loadedSizes[0] != windowsSmallIconPixels || loadedSizes[1] != windowsLargeIconPixels {
		t.Fatalf("loaded icon sizes = %v, want [%d %d]", loadedSizes, windowsSmallIconPixels, windowsLargeIconPixels)
	}
	if taskbarIconPath != iconPath {
		t.Fatalf("taskbar icon path = %q, want %q", taskbarIconPath, iconPath)
	}
	if shortcutIconPath != iconPath {
		t.Fatalf("shortcut icon path = %q, want %q", shortcutIconPath, iconPath)
	}
	if got := strings.Join(identityEvents, ","); got != "shortcut,window" {
		t.Fatalf("startup identity order = %q, want shortcut,window", got)
	}
	if err := InitializePersistedNativeBrandIcon(application, ctx); err != nil {
		t.Fatalf("initialize persisted native brand icon again: %v", err)
	}
	if shortcutUpdateCount != 1 {
		t.Fatalf("shortcut update count = %d, want one-time MSI migration", shortcutUpdateCount)
	}
	migrationPath := filepath.Join(configDir, windowsApplicationIconDirectoryName, ".taskbar-identity-v1")
	migrationState, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("taskbar identity migration state: %v", err)
	}
	wantIdentity := windowsApplicationUserModelIDForIconPath(iconPath)
	if state := string(migrationState); !containsAll(state, AppVersion, wantIdentity, strings.ToLower(filepath.Join(installDir, "GoNavi.exe"))) {
		t.Fatalf("taskbar identity migration state = %q", state)
	}
	AppVersion = "1.0.1"
	if err := InitializePersistedNativeBrandIcon(application, ctx); err != nil {
		t.Fatalf("initialize persisted native brand icon after MSI update: %v", err)
	}
	if shortcutUpdateCount != 2 {
		t.Fatalf("shortcut update count after MSI update = %d, want 2", shortcutUpdateCount)
	}
}

func TestRepairPersistedWindowsApplicationShortcutsOnceSkipsPortable(t *testing.T) {
	originalUpdateShortcuts := windowsUpdateCurrentApplicationShortcuts
	originalResolveInstallTarget := updateResolveInstallTarget
	t.Cleanup(func() {
		windowsUpdateCurrentApplicationShortcuts = originalUpdateShortcuts
		updateResolveInstallTarget = originalResolveInstallTarget
	})

	installDir := t.TempDir()
	updateResolveInstallTarget = func() string {
		return filepath.Join(installDir, "GoNavi.exe")
	}
	windowsUpdateCurrentApplicationShortcuts = func(string) error {
		t.Fatal("portable startup must not migrate MSI taskbar shortcuts")
		return nil
	}
	configDir := t.TempDir()
	repairPersistedWindowsApplicationShortcutsOnce(`C:\icons\gonavi-brand.ico`, configDir)
	migrationPath := filepath.Join(configDir, windowsApplicationIconDirectoryName, ".taskbar-identity-v1")
	if _, err := os.Stat(migrationPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("portable migration marker error = %v, want not exist", err)
	}
}

func TestSetApplicationIconPNGDoesNotActivateAfterShortcutFailure(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	source.SetNRGBA(0, 0, color.NRGBA{R: 0x44, G: 0x88, B: 0xcc, A: 0xff})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	configDir := t.TempDir()
	if err := clearPersistedWindowsApplicationIcon(configDir); err != nil {
		t.Fatalf("initialize empty active icon state: %v", err)
	}
	originalUpdate := windowsUpdateCurrentApplicationShortcuts
	t.Cleanup(func() { windowsUpdateCurrentApplicationShortcuts = originalUpdate })
	windowsUpdateCurrentApplicationShortcuts = func(string) error {
		return errors.New("shortcut update failed")
	}

	if err := setApplicationIconPNG(encoded.Bytes(), configDir, context.Background()); err == nil {
		t.Fatal("expected shortcut update failure")
	}
	activeStatePath := filepath.Join(configDir, windowsApplicationIconDirectoryName, windowsApplicationIconStateFileName)
	if data, err := os.ReadFile(activeStatePath); err != nil || strings.TrimSpace(string(data)) != "" {
		t.Fatalf("active icon state after failed live apply = %q, err=%v, want empty", string(data), err)
	}
}

func TestPrepareWindowsBrandIconRestartDoesNotActivateAfterShortcutFailure(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	source.SetNRGBA(0, 0, color.NRGBA{R: 0x99, G: 0x33, B: 0x55, A: 0xff})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	configDir := t.TempDir()
	if err := clearPersistedWindowsApplicationIcon(configDir); err != nil {
		t.Fatalf("initialize empty active icon state: %v", err)
	}
	originalUpdate := windowsUpdateCurrentApplicationShortcuts
	t.Cleanup(func() { windowsUpdateCurrentApplicationShortcuts = originalUpdate })
	windowsUpdateCurrentApplicationShortcuts = func(string) error {
		return errors.New("shortcut update failed")
	}

	if err := prepareWindowsBrandIconRestartPNG(encoded.Bytes(), configDir); err == nil {
		t.Fatal("expected shortcut update failure")
	}
	activeStatePath := filepath.Join(configDir, windowsApplicationIconDirectoryName, windowsApplicationIconStateFileName)
	if data, err := os.ReadFile(activeStatePath); err != nil || strings.TrimSpace(string(data)) != "" {
		t.Fatalf("active icon state after failed prepare = %q, err=%v, want empty", string(data), err)
	}
	candidatePath := windowsApplicationIconCandidatePath(encoded.Bytes(), configDir)
	if _, err := os.Stat(candidatePath); err != nil {
		t.Fatalf("failed prepare should retain candidate ICO for partial shortcut updates: %v", err)
	}
}

func TestRemoveStaleWindowsShortcutUpdateScriptsKeepsIconState(t *testing.T) {
	configDir := t.TempDir()
	iconDir := filepath.Join(configDir, windowsApplicationIconDirectoryName)
	if err := os.MkdirAll(iconDir, 0o755); err != nil {
		t.Fatal(err)
	}
	staleScripts := []string{".gonavi-brand-shortcuts-123.ps1", ".gonavi-brand-shortcuts-456.ps1"}
	for _, name := range staleScripts {
		if err := os.WriteFile(filepath.Join(iconDir, name), []byte("script"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	keep := map[string]string{
		"gonavi-brand-d89e4f026a938e22fe081e12.ico": "ico",
		windowsApplicationIconStateFileName:         "gonavi-brand-d89e4f026a938e22fe081e12.ico\n",
		".gonavi-brand-shortcuts.ps1":               "not matching the numbered temp pattern",
	}
	for name, content := range keep {
		if err := os.WriteFile(filepath.Join(iconDir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	removeStaleWindowsShortcutUpdateScripts(configDir)

	for _, name := range staleScripts {
		if _, err := os.Stat(filepath.Join(iconDir, name)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("stale shortcut script %s was not removed: %v", name, err)
		}
	}
	for name := range keep {
		if _, err := os.Stat(filepath.Join(iconDir, name)); err != nil {
			t.Fatalf("cleanup removed %s: %v", name, err)
		}
	}
}
