//go:build windows

package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"unsafe"

	"GoNavi-Wails/internal/logger"

	"golang.org/x/sys/windows"
)

const (
	windowsImageIcon                     = 1
	windowsLoadFromFile                  = 0x0010
	windowsGetIconMessage                = 0x007f
	windowsSetIconMessage                = 0x0080
	windowsIconSmall                     = 0
	windowsIconBig                       = 1
	windowsClassIconLarge                = -14
	windowsClassIconSmall                = -34
	windowsShortcutIdentityStateFileName = ".taskbar-identity-v1"
)

var (
	windowsApplicationIconUser32           = windows.NewLazySystemDLL("user32.dll")
	windowsApplicationIconLoadImage        = windowsApplicationIconUser32.NewProc("LoadImageW")
	windowsApplicationIconGetDpiForSystem  = windowsApplicationIconUser32.NewProc("GetDpiForSystem")
	windowsApplicationIconGetWindowLong    = windowsApplicationIconUser32.NewProc("GetWindowLongW")
	windowsApplicationIconSetWindowLong    = windowsApplicationIconUser32.NewProc("SetWindowLongW")
	windowsApplicationIconGetWindowLongPtr = windowsApplicationIconUser32.NewProc("GetWindowLongPtrW")
	windowsApplicationIconSetWindowLongPtr = windowsApplicationIconUser32.NewProc("SetWindowLongPtrW")
	windowsApplicationIconRtlGetVersion    = windows.NewLazySystemDLL("ntdll.dll").NewProc("RtlGetVersion")
	windowsApplicationIconSendMessage      = windowsApplicationIconUser32.NewProc("SendMessageW")
	windowsApplicationIconSetClassLong     = windowsApplicationIconUser32.NewProc("SetClassLongW")
	windowsApplicationIconSetClassLongPtr  = windowsApplicationIconUser32.NewProc("SetClassLongPtrW")
	windowsApplicationIconDestroy          = windowsApplicationIconUser32.NewProc("DestroyIcon")
	windowsApplicationIconHandleMu         sync.Mutex
	windowsApplicationIconSmallHandle      uintptr
	windowsApplicationIconLargeHandle      uintptr

	windowsApplicationIconSendMessageCall = func(hwnd, message, wParam, lParam uintptr) uintptr {
		result, _, _ := windowsApplicationIconSendMessage.Call(hwnd, message, wParam, lParam)
		return result
	}
	windowsApplicationIconSetClassIcon = func(hwnd uintptr, index int32, icon uintptr) {
		proc := windowsApplicationIconSetClassLongPtr
		if unsafe.Sizeof(uintptr(0)) == 4 {
			proc = windowsApplicationIconSetClassLong
		}
		proc.Call(hwnd, uintptr(int64(index)), icon)
	}
	windowsApplicationIconSetTaskbarProperties = setWindowsTaskbarProperties
	windowsApplicationIconLoad                 = loadWindowsApplicationIcon
	windowsApplicationIconSystemDPI            = currentWindowsSystemDPI
	windowsApplicationBuildNumber              = currentWindowsBuildNumber
	windowsRefreshLegacyTaskbarButton          = refreshWindows10TaskbarButton
	windowsApplicationIconDestroyCall          = destroyWindowsApplicationIcon
	windowsUpdateCurrentApplicationShortcuts   = updateCurrentWindowsApplicationShortcuts
)

// applyPersistedWindowsApplicationIcon binds the last selected ICO before
// Wails shows the first window. The frontend state is hydrated too late to be
// the first source of truth for the Windows taskbar button.
func applyPersistedWindowsApplicationIcon(runtimeContext context.Context, configDir string) error {
	removeStaleWindowsShortcutUpdateScripts(configDir)
	iconPath, err := loadPersistedWindowsApplicationIcon(configDir)
	if err != nil {
		return err
	}
	if strings.TrimSpace(iconPath) == "" {
		return clearPersistedWindowsApplicationIcon(configDir)
	}
	repairPersistedWindowsApplicationShortcutsOnce(iconPath, configDir)
	_, err = setCurrentWindowsApplicationIcon(runtimeContext, iconPath)
	if err != nil {
		return err
	}
	// Persist the compatibility fallback too. This makes later failed
	// selections transactional: the active pointer remains authoritative and
	// an unactivated candidate cannot win the next startup scan.
	if err := activatePersistedWindowsApplicationIcon(iconPath, configDir); err != nil {
		return fmt.Errorf("persist active Windows application icon: %w", err)
	}
	return nil
}

func repairPersistedWindowsApplicationShortcutsOnce(iconPath, configDir string) {
	state, ok := currentWindowsShortcutIdentityState(iconPath)
	if !ok {
		return
	}
	statePath := filepath.Join(configDir, windowsApplicationIconDirectoryName, windowsShortcutIdentityStateFileName)
	currentState, err := os.ReadFile(statePath)
	if err == nil && string(currentState) == state {
		return
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		logger.Warnf("检查 Windows 任务栏身份迁移状态失败：%v", err)
		return
	}
	if err := os.MkdirAll(filepath.Dir(statePath), 0o755); err != nil {
		logger.Warnf("创建 Windows 任务栏身份迁移目录失败：%v", err)
		return
	}
	if err := windowsUpdateCurrentApplicationShortcuts(iconPath); err != nil {
		logger.Warnf("更新 Windows 应用快捷方式图标失败：%v", err)
		return
	}
	if err := os.WriteFile(statePath, []byte(state), 0o600); err != nil {
		logger.Warnf("记录 Windows 任务栏身份迁移状态失败：%v", err)
	}
}

func currentWindowsShortcutIdentityState(iconPath string) (string, bool) {
	executablePath := strings.TrimSpace(updateResolveInstallTarget())
	// Both installs refresh their own pins once per version. The script only
	// changes IconLocation, and it rewrites a target when that target is
	// already missing or points at a brand ICO.
	mode := resolveUpdateInstallModeForExecutable("windows", executablePath)
	if mode != updateInstallModeMSI && mode != updateInstallModePortable {
		return "", false
	}
	return strings.Join([]string{
		strings.TrimSpace(getCurrentVersion()),
		windowsApplicationUserModelIDForIconPath(iconPath),
		strings.ToLower(filepath.Clean(executablePath)),
	}, "\n") + "\n", true
}

func recordCurrentWindowsShortcutIdentityState(iconPath, configDir string) {
	state, ok := currentWindowsShortcutIdentityState(iconPath)
	if !ok {
		return
	}
	statePath := filepath.Join(configDir, windowsApplicationIconDirectoryName, windowsShortcutIdentityStateFileName)
	if err := os.WriteFile(statePath, []byte(state), 0o600); err != nil {
		logger.Warnf("记录 Windows 任务栏身份迁移状态失败：%v", err)
	}
}

func setApplicationIconPNG(pngBytes []byte, configDir string, runtimeContext context.Context) error {
	if len(pngBytes) == 0 {
		return errors.New("application icon PNG is empty")
	}
	if strings.TrimSpace(configDir) == "" {
		configDir = resolveAppConfigDir()
	}
	iconPath, err := persistWindowsApplicationIcon(pngBytes, configDir)
	if err != nil {
		return err
	}
	// Update shortcuts before refreshing the live window icon. The update is
	// synchronous so quitting cannot leave a half-written pin. The taskbar
	// identity is not changed.
	if err := windowsUpdateCurrentApplicationShortcuts(iconPath); err != nil {
		return err
	}
	if err := activatePersistedWindowsApplicationIcon(iconPath, configDir); err != nil {
		return err
	}
	recordCurrentWindowsShortcutIdentityState(iconPath, configDir)
	_, err = setCurrentWindowsApplicationIcon(runtimeContext, iconPath)
	if err != nil {
		return err
	}
	return nil
}

func prepareWindowsBrandIconRestartPNG(pngBytes []byte, configDir string) error {
	if len(pngBytes) == 0 {
		return errors.New("application icon PNG is empty")
	}
	if strings.TrimSpace(configDir) == "" {
		configDir = resolveAppConfigDir()
	}
	iconPath, err := persistWindowsApplicationIcon(pngBytes, configDir)
	if err != nil {
		return err
	}
	// Update existing shortcuts in place. Only activate the pointer after the
	// shortcut transaction succeeds, so a failed selection cannot change the
	// icon used by the next process launch.
	if err := windowsUpdateCurrentApplicationShortcuts(iconPath); err != nil {
		// Keep the content-addressed ICO because the shortcut script may have
		// updated some entries before reporting an error. The active pointer is
		// unchanged, so the next startup will continue using the previous icon.
		return err
	}
	if err := activatePersistedWindowsApplicationIcon(iconPath, configDir); err != nil {
		return err
	}
	recordCurrentWindowsShortcutIdentityState(iconPath, configDir)
	return nil
}

func setCurrentWindowsApplicationIcon(runtimeContext context.Context, iconPath string) (uintptr, error) {
	if err := migrateWindowsApplicationIconFile(iconPath); err != nil {
		return 0, err
	}
	dpi := windowsApplicationIconSystemDPI()
	small, err := windowsApplicationIconLoad(iconPath, windowsTaskbarIconPixels(dpi))
	if err != nil {
		return 0, err
	}
	large, err := windowsApplicationIconLoad(iconPath, windowsAltTabIconPixels(dpi))
	if err != nil {
		windowsApplicationIconDestroyCall(small)
		return 0, err
	}

	mainWindow, err := resolveWailsMainWindowHandle(runtimeContext)
	if err != nil {
		windowsApplicationIconDestroyCall(small)
		windowsApplicationIconDestroyCall(large)
		return 0, fmt.Errorf("resolve Windows application window: %w", err)
	}
	applyErr := applyWindowsApplicationIcon(mainWindow, iconPath, small, large)

	// WM_SETICON / class icon calls transfer live references to these handles.
	// Keep them alive even when Explorer's taskbar refresh reports an error.
	windowsApplicationIconHandleMu.Lock()
	previousSmall := windowsApplicationIconSmallHandle
	previousLarge := windowsApplicationIconLargeHandle
	windowsApplicationIconSmallHandle = small
	windowsApplicationIconLargeHandle = large
	windowsApplicationIconHandleMu.Unlock()
	windowsApplicationIconDestroyCall(previousSmall)
	windowsApplicationIconDestroyCall(previousLarge)
	if applyErr != nil {
		return mainWindow, applyErr
	}
	return mainWindow, nil
}

func resolveWailsMainWindowHandle(runtimeContext context.Context) (handle uintptr, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			handle = 0
			err = fmt.Errorf("resolve Wails main window handle panic: %v", recovered)
		}
	}()
	if runtimeContext == nil {
		return 0, errors.New("runtime context is nil")
	}
	frontendValue, err := resolveWailsFrontendValue(runtimeContext)
	if err != nil {
		return 0, err
	}
	mainWindowValue, err := accessibleWailsFrontendField(frontendValue, "mainWindow")
	if err != nil {
		return 0, err
	}
	handleMethod := mainWindowValue.MethodByName("Handle")
	if !handleMethod.IsValid() {
		return 0, errors.New("mainWindow.Handle method not found (wails version may have changed)")
	}
	if handleMethod.Type().NumIn() != 0 || handleMethod.Type().NumOut() != 1 {
		return 0, fmt.Errorf("mainWindow.Handle signature changed: expected func() uintptr, got %v", handleMethod.Type())
	}
	result := handleMethod.Call(nil)[0]
	if result.Kind() != reflect.Uintptr && result.Kind() != reflect.Uint && result.Kind() != reflect.Uint64 && result.Kind() != reflect.Uint32 {
		return 0, fmt.Errorf("mainWindow.Handle returned unsupported kind %v", result.Kind())
	}
	handle = uintptr(result.Uint())
	if handle == 0 {
		return 0, errors.New("mainWindow.Handle returned zero")
	}
	return handle, nil
}

func applyWindowsApplicationIcon(hwnd uintptr, iconPath string, small, large uintptr) error {
	if hwnd == 0 {
		return errors.New("Windows application window handle is zero")
	}
	windowsApplicationIconSendMessageCall(hwnd, windowsSetIconMessage, windowsIconSmall, small)
	windowsApplicationIconSendMessageCall(hwnd, windowsSetIconMessage, windowsIconBig, large)

	// WM_SETICON is the live taskbar/Alt+Tab source. Updating the class fallback
	// as well prevents a later non-client refresh from restoring Wails' embedded
	// executable icon.
	windowsApplicationIconSetClassIcon(hwnd, windowsClassIconSmall, small)
	windowsApplicationIconSetClassIcon(hwnd, windowsClassIconLarge, large)

	actualSmall := windowsApplicationIconSendMessageCall(hwnd, windowsGetIconMessage, windowsIconSmall, 0)
	actualLarge := windowsApplicationIconSendMessageCall(hwnd, windowsGetIconMessage, windowsIconBig, 0)
	if actualSmall != small || actualLarge != large {
		return fmt.Errorf(
			"Windows icon readback mismatch: small=%#x want=%#x, large=%#x want=%#x",
			actualSmall,
			small,
			actualLarge,
			large,
		)
	}
	if err := windowsApplicationIconSetTaskbarProperties(hwnd, iconPath); err != nil {
		return fmt.Errorf("set Windows taskbar icon properties: %w", err)
	}
	// Windows 10 keeps the taskbar button that was created with the original
	// icon. Rebuilding that button is what makes a logo switch visible there.
	// Windows 11 already repaints from WM_SETICON, so it must not flicker.
	windowsRefreshLegacyTaskbarButton(hwnd)
	return nil
}

const (
	windowsGWLExStyle     int32 = -20
	windowsWSExToolWindow       = uintptr(0x00000080)
)

func currentWindowsBuildNumber() uint32 {
	if windowsApplicationIconRtlGetVersion.Find() != nil {
		return 0
	}
	type osVersionInfo struct {
		size                          uint32
		major, minor, build, platform uint32
		servicePack                   [128]uint16
	}
	info := osVersionInfo{size: uint32(unsafe.Sizeof(osVersionInfo{}))}
	if result, _, _ := windowsApplicationIconRtlGetVersion.Call(uintptr(unsafe.Pointer(&info))); result != 0 {
		return 0
	}
	return info.build
}

func windowsWindowLongProc(ptrProc, fallbackProc *windows.LazyProc) *windows.LazyProc {
	if unsafe.Sizeof(uintptr(0)) == 4 {
		return fallbackProc
	}
	return ptrProc
}

// windowsLongIndex converts a signed index such as GWL_EXSTYLE (-20) after it
// is stored in a variable. A negative constant cannot convert to uintptr.
func windowsLongIndex(index int32) uintptr {
	return uintptr(index)
}

func windowsGetWindowExStyle(hwnd uintptr) uintptr {
	proc := windowsWindowLongProc(windowsApplicationIconGetWindowLongPtr, windowsApplicationIconGetWindowLong)
	style, _, _ := proc.Call(hwnd, windowsLongIndex(windowsGWLExStyle))
	return style
}

func windowsSetWindowExStyle(hwnd uintptr, style uintptr) {
	proc := windowsWindowLongProc(windowsApplicationIconSetWindowLongPtr, windowsApplicationIconSetWindowLong)
	proc.Call(hwnd, windowsLongIndex(windowsGWLExStyle), style)
}

// refreshWindows10TaskbarButton drops the taskbar button and puts it back so
// Explorer copies the icon just applied with WM_SETICON. Windows 11 does not
// need this, and hiding the button there would flicker a working icon.
func refreshWindows10TaskbarButton(hwnd uintptr) {
	build := windowsApplicationBuildNumber()
	if hwnd == 0 || build == 0 || build >= 22000 {
		return
	}
	style := windowsGetWindowExStyle(hwnd)
	if style == 0 {
		return
	}
	windowsSetWindowExStyle(hwnd, style|windowsWSExToolWindow)
	windowsSetWindowExStyle(hwnd, style)
}

func currentWindowsSystemDPI() int {
	if windowsApplicationIconGetDpiForSystem.Find() != nil {
		return 96
	}
	dpi, _, _ := windowsApplicationIconGetDpiForSystem.Call()
	if dpi < 96 {
		return 96
	}
	return int(dpi)
}

func loadWindowsApplicationIcon(iconPath string, size int) (uintptr, error) {
	path, err := windows.UTF16PtrFromString(iconPath)
	if err != nil {
		return 0, fmt.Errorf("encode Windows application icon path: %w", err)
	}
	handle, _, callErr := windowsApplicationIconLoadImage.Call(
		0,
		uintptr(unsafe.Pointer(path)),
		windowsImageIcon,
		uintptr(size),
		uintptr(size),
		windowsLoadFromFile,
	)
	if handle == 0 {
		return 0, fmt.Errorf("load %dx%d Windows application icon: %w", size, size, callErr)
	}
	return handle, nil
}

func destroyWindowsApplicationIcon(handle uintptr) {
	if handle != 0 {
		windowsApplicationIconDestroy.Call(handle)
	}
}

func updateCurrentWindowsApplicationShortcuts(iconPath string) error {
	executablePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve Windows application executable: %w", err)
	}
	scriptDir := filepath.Dir(iconPath)
	temporary, err := os.CreateTemp(scriptDir, ".gonavi-brand-shortcuts-*.ps1")
	if err != nil {
		return fmt.Errorf("create Windows shortcut update script: %w", err)
	}
	scriptPath := temporary.Name()
	defer os.Remove(scriptPath)
	script := windowsShortcutRepairPowerShellScript + `

$ErrorActionPreference = 'Stop'
[void](Set-GoNaviShortcutBrandIcon -TargetPath $env:GONAVI_BRAND_TARGET -IconPath $env:GONAVI_BRAND_ICON -ApplicationUserModelID $env:GONAVI_BRAND_AUMID)
`
	if _, err := temporary.WriteString(strings.ReplaceAll(script, "\n", "\r\n")); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write Windows shortcut update script: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close Windows shortcut update script: %w", err)
	}

	cmd := exec.Command(
		"powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		windowsUpdatePowerShellExecutionPolicy,
		"-File",
		scriptPath,
	)
	cmd.Dir = scriptDir
	cmd.Env = append(cmd.Environ(),
		"GONAVI_BRAND_TARGET="+executablePath,
		"GONAVI_BRAND_ICON="+iconPath,
		"GONAVI_BRAND_AUMID="+windowsApplicationUserModelIDForIconPath(iconPath),
		"GONAVI_BRAND_MATCH_TARGET_ONLY="+windowsBrandShortcutMatchTargetOnlyEnv(executablePath),
	)
	configureWindowsUpdateCommand(cmd)
	if output, err := cmd.CombinedOutput(); err != nil {
		detail := strings.TrimSpace(string(output))
		if detail != "" {
			return fmt.Errorf("update Windows application shortcuts: %w: %s", err, detail)
		}
		return fmt.Errorf("update Windows application shortcuts: %w", err)
	}
	return nil
}

// removeStaleWindowsShortcutUpdateScripts deletes PowerShell payloads left in
// the icon directory when a previous brand-icon selection was interrupted
// before its deferred cleanup could run.
func removeStaleWindowsShortcutUpdateScripts(configDir string) {
	iconDir := filepath.Join(strings.TrimSpace(configDir), windowsApplicationIconDirectoryName)
	entries, err := os.ReadDir(iconDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, ".gonavi-brand-shortcuts-") || !strings.HasSuffix(name, ".ps1") {
			continue
		}
		_ = os.Remove(filepath.Join(iconDir, name))
	}
}
