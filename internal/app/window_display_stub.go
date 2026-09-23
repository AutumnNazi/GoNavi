//go:build !darwin || !cgo

package app

// Windows/Linux 的 WindowGetPosition 已经返回全局坐标，保存的记忆位置本身
// 就带显示器信息，无需额外枚举显示器工作区。
const mainWindowPositionIsGlobal = true

func mainWindowDisplayAreas() []mainWindowDisplayArea {
	return nil
}
