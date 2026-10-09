package app

import (
	"context"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

// queryConnectionRequest 描述一次「查询前取连接」的方式。
//
// 用结构体而不是两个裸 bool：调用点写成 acquireQueryConnection(ctx, config, true, false)
// 完全读不出哪一个是「把 Connect 留在当前 goroutine」、哪一个是「强制 ping 已有连接」。
type queryConnectionRequest struct {
	// config 为归一化后的运行期连接配置（normalizeRunConfig 的产物）。
	config connection.ConnectionConfig
	// synchronous 为 true 时把非 context 感知的 Connect 留在当前 goroutine，
	// 保证 Web RPC 取消后不会留下仍在建连的游离 worker。
	synchronous bool
	// forcePing 强制校验并刷新已有缓存连接，用于查询失败后的重建重试。
	forcePing bool
}

// acquireQueryConnection 取（或冷建、或重建）查询用连接，并附带这次等待的毫秒数。
//
// 之所以把耗时一起返回，而不是让每个调用点各自摊开 time.Now()/time.Since：
// 「链路分解」的其余一段需要把取连接开销从主查询耗时里分离出来，而取连接在本层
// 有四处（含两处被 if/else 与重试分支包着），逐处摊开既啰嗦又容易漏掉重试那次。
//
// 用原始 Milliseconds 而不是 durationMilliseconds：后者把「有等待」兜底成 1ms，
// 缓存命中的亚毫秒等待会被记成 1ms 的假开销；这里 0 就是真的没等。
func (a *App) acquireQueryConnection(ctx context.Context, request queryConnectionRequest) (db.Database, int64, error) {
	startedAt := time.Now()
	var instance db.Database
	var err error
	if request.synchronous {
		instance, err = a.getDatabaseSynchronouslyWithContext(ctx, request.config, request.forcePing)
	} else {
		instance, err = a.getDatabaseWithContext(ctx, request.config, request.forcePing)
	}
	return instance, time.Since(startedAt).Milliseconds(), err
}
