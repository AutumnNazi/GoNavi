package app

import "GoNavi-Wails/internal/connection"

// mainWindowDisplayArea 描述一块显示器工作区（已排除菜单栏/任务栏），统一使用
// **全局左上原点**坐标：x/y 是工作区左上角，y 向下增长。
//
// Wails 的 WindowGetPosition/WindowSetPosition 在 macOS 上以“当前显示器可见区
// 左上角”为原点，保存下来的局部坐标不含显示器身份，因此换屏重启无法回到原显示器。
// 前端据此列表先把记忆位置换算成全局坐标再恢复。
type mainWindowDisplayArea struct {
	X       int  `json:"x"`
	Y       int  `json:"y"`
	Width   int  `json:"width"`
	Height  int  `json:"height"`
	Primary bool `json:"primary"`
	Current bool `json:"current"`
}

type mainWindowDisplayLayout struct {
	Displays []mainWindowDisplayArea `json:"displays"`
	// PositionIsGlobal 说明本平台 WindowGetPosition/WindowSetPosition 是否已使用
	// 全局坐标。Windows/Linux 是，macOS 不是（需要前端按 Current 工作区原点换算）。
	PositionIsGlobal bool `json:"positionIsGlobal"`
}

// GetMainWindowDisplayLayout 枚举主窗口可用的显示器工作区，供前端按全局坐标
// 记住并恢复窗口位置；不支持枚举的平台返回空列表，前端回退到按当前屏处理。
func (a *App) GetMainWindowDisplayLayout() connection.QueryResult {
	return connection.QueryResult{
		Success: true,
		Message: "window display layout",
		Data:    buildMainWindowDisplayLayout(mainWindowDisplayAreas(), mainWindowPositionIsGlobal),
	}
}

func buildMainWindowDisplayLayout(
	displays []mainWindowDisplayArea,
	positionIsGlobal bool,
) mainWindowDisplayLayout {
	normalized := make([]mainWindowDisplayArea, 0, len(displays))
	for _, display := range displays {
		if display.Width <= 0 || display.Height <= 0 {
			continue
		}
		normalized = append(normalized, display)
	}
	return mainWindowDisplayLayout{
		Displays:         normalized,
		PositionIsGlobal: positionIsGlobal,
	}
}
