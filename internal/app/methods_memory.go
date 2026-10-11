package app

import (
	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
)

// ReclaimMemory 主动回收进程内存，供前端在批量解码后调用（如元数据预热全力模式完成）。
//
// 预热期要把大量元数据 JSON 从 IPC 解成 Go 结构，堆峰值远高于稳态；Go 的运行时
// 即使已无引用也不会立刻把内存还给操作系统（归还取决于 GOGC 与 scavenger 节奏），
// 低配机上表现为「预热完内存依然居高不下」。这里显式触发一次 GC 并让运行时把
// 空闲页归还 OS。
//
// 复用 memory_reclaim.go 的 fileTransferMemoryTrimFn（runtime.GC + debug.FreeOSMemory），
// 而不是再写一份 GC 逻辑：同一个「主动 trim」动作在大文件导入导出路径上已经存在，
// 两条触发路径共用一份实现才能保证将来只改一处（例如加节流、换 API）。
func (a *App) ReclaimMemory() connection.QueryResult {
	logger.Infof("前端请求主动回收进程内存（元数据预热完成）")
	fileTransferMemoryTrimFn()
	return connection.QueryResult{Success: true, Message: a.appText("common.success", nil)}
}
