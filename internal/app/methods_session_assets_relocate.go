package app

import (
	"context"
	"strings"

	"GoNavi-Wails/internal/connection"
)

// SessionAssetsRelocateSource 重定位来源历史目录。新身份与同工具其他
// 来源冲突时拒绝，不覆盖冲突身份（V-22）；重定位后立即补核对并重启
// 观察。
func (a *App) SessionAssetsRelocateSource(sourceID, newRootPath string) (result connection.QueryResult) {
	newRoot := strings.TrimSpace(newRootPath)
	if strings.TrimSpace(sourceID) == "" || newRoot == "" {
		return connection.QueryResult{Success: false, Message: a.appText("session_assets.error.relocate_failed", map[string]any{"detail": "missing source or path"})}
	}
	catalog, service, err := a.sessionAssetsCatalog()
	if err != nil {
		return sessionAssetsServiceError(a, err)
	}
	if _, err := catalog.GetSource(context.Background(), sourceID); err != nil {
		return sessionAssetsError(a, "session_assets.error.integration_not_found", err)
	}
	identity := "dir:" + strings.ToLower(strings.ReplaceAll(strings.TrimRight(newRoot, "\\/"), "\\", "/"))
	if err := catalog.RelocateSource(context.Background(), sourceID, newRoot, identity); err != nil {
		return sessionAssetsError(a, "session_assets.error.relocate_failed", err)
	}
	relocated, err := catalog.GetSource(context.Background(), sourceID)
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.list_failed", err)
	}
	a.syncAndObserveSource(service, relocated)
	return connection.QueryResult{Success: true}
}
