package app

// Windows 10 和 Windows 11 的默认任务栏在 96 DPI 下都是大约 24px，Alt+Tab 大约是 32px。
// 16px 只是标题栏小图标，以及勾选「使用小任务栏按钮」时的尺寸。
// 只交给系统 16px 时，任务栏会按原尺寸居中，看起来比旁边的应用小一圈。
const (
	windowsTaskbarIconBasePixels = 24
	windowsAltTabIconBasePixels  = 32
)

func windowsScaledIconPixels(base int, dpi int) int {
	if base < 1 {
		base = 1
	}
	if dpi < 96 {
		dpi = 96
	}
	return (base*dpi + 48) / 96
}

// windowsIconFrameSize 取不小于目标像素的内置 ICO 帧，避免任务栏把更小的帧放大后发虚、显小。
func windowsIconFrameSize(requested int) int {
	for _, size := range []int{16, 24, 32, 48, 64, 128, 256} {
		if size >= requested {
			return size
		}
	}
	return 256
}

func windowsTaskbarIconPixels(dpi int) int {
	return windowsIconFrameSize(windowsScaledIconPixels(windowsTaskbarIconBasePixels, dpi))
}

func windowsAltTabIconPixels(dpi int) int {
	return windowsIconFrameSize(windowsScaledIconPixels(windowsAltTabIconBasePixels, dpi))
}
