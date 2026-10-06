package app

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"GoNavi-Wails/internal/appdata"
	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/sessionassets"
	"GoNavi-Wails/internal/sessionassets/adapters/codex"
)

// 智能体会话资产的 Wails 绑定：检测、启用、禁用与集成列表。
// 绑定层只做参数校验、状态合成与 QueryResult 收拢；探测在 codex 适配器，
// 领域规则在 sessionassets（GO_STYLE §13）。

// sourceIdentityKey 由规范化数据目录构造来源身份。跨设备/卷级别的身份
// 精化在来源发现接入时扩展，不改变键的语义。
func sourceIdentityKey(dataDir string) string {
	trimmed := strings.TrimSpace(dataDir)
	if trimmed == "" {
		return ""
	}
	normalized := strings.ToLower(filepath.ToSlash(filepath.Clean(trimmed)))
	return "dir:" + normalized
}

// SessionAssetsDetect 检测本机智能体安装与可读使用位置，并合成集成状态。
// 检测不发送测试消息，也不要求已有会话（S-05）。
func (a *App) SessionAssetsDetect(input sessionassets.DetectInput) (result connection.QueryResult) {
	kind, supported := sessionassets.NormalizeAgentKind(input.Kind)
	if !supported {
		return sessionAssetsUnsupportedResult(a, input.Kind)
	}
	detection := a.detectAgentKind(context.Background(), kind, input.CommandPath, input.DataDir)
	view := a.buildDetectionView(kind, detection)
	return connection.QueryResult{Success: true, Data: view}
}

// SessionAssetsEnable 在检测通过后启用智能体集成。重复启用幂等返回
// 已有配置；材料库被占用时不启用并返回锁定状态（V-01/V-13）。
func (a *App) SessionAssetsEnable(input sessionassets.EnableInput) (result connection.QueryResult) {
	kind, supported := sessionassets.NormalizeAgentKind(input.Kind)
	if !supported {
		return sessionAssetsUnsupportedResult(a, input.Kind)
	}
	detection := a.detectAgentKind(context.Background(), kind, input.CommandPath, input.DataDir)
	if detection.Status != codex.StatusReady {
		logger.Warnf("会话资产启用被拒绝：kind=%s status=%s", kind, detection.Status)
		return connection.QueryResult{
			Success: false,
			Message: a.appText("session_assets.error.detect_not_ready", map[string]any{
				"status": a.agentDetectionStatusText(detection.Status),
			}),
			Data: a.buildDetectionView(kind, detection),
		}
	}

	if trimmed := strings.TrimSpace(input.MaterialsRoot); trimmed != "" {
		resolved, err := appdata.ResolveSessionAssetsDirectory(appdata.MustResolveActiveRoot())
		if err == nil && filepath.Clean(resolved) != filepath.Clean(trimmed) {
			if _, err := appdata.SetConfiguredSessionAssetsDirectory(trimmed); err != nil {
				return sessionAssetsError(a, "session_assets.error.materials_root_rejected", err)
			}
		}
	}
	service, err := a.ensureSessionAssetsService()
	if err != nil {
		return sessionAssetsServiceError(a, err)
	}
	catalog := service.Catalog()
	integration, err := catalog.EnableIntegration(context.Background(), sessionassets.AgentKind(kind), "Codex")
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.enable_failed", err)
	}
	if identity := sourceIdentityKey(detection.DataDir); identity != "" {
		if _, err := catalog.UpsertSource(context.Background(), sessionassets.SourceInput{
			IntegrationID: integration.ID,
			Kind:          "cli",
			DisplayName:   "Codex",
			RootPath:      detection.DataDir,
			IdentityKey:   identity,
		}); err != nil {
			return sessionAssetsError(a, "session_assets.error.enable_failed", err)
		}
	}
	if err := catalog.SetIntegrationEnabled(context.Background(), integration.ID, true); err != nil {
		return sessionAssetsError(a, "session_assets.error.enable_failed", err)
	}
	logger.Infof("会话资产集成已启用：kind=%s dataDir=%s", kind, detection.DataDir)
	a.resumeSessionAssetSources(service)
	view := a.buildDetectionView(kind, detection)
	view.IntegrationID = integration.ID
	view.IntegrationStatus = sessionassets.IntegrationStatusEnabled
	return connection.QueryResult{Success: true, Data: view}
}

// SessionAssetsDisable 禁用集成：停止全部来源观察、取消排队任务，保留
// 配置、节点与资产（FR-28/AC-14）。运行中的任务在提交前再次检查启用
// 状态，不会写入新结果。
func (a *App) SessionAssetsDisable(kind string) (result connection.QueryResult) {
	normalized, supported := sessionassets.NormalizeAgentKind(kind)
	if !supported {
		return sessionAssetsUnsupportedResult(a, kind)
	}
	catalog, service, err := a.sessionAssetsCatalog()
	if err != nil {
		return sessionAssetsServiceError(a, err)
	}
	integration, err := a.findIntegrationByKind(catalog, normalized)
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.integration_not_found", err)
	}
	if err := catalog.SetIntegrationEnabled(context.Background(), integration.ID, false); err != nil {
		return sessionAssetsError(a, "session_assets.error.disable_failed", err)
	}
	disableIntegrationRuntime(service, integration.ID)
	return connection.QueryResult{Success: true}
}

// SessionAssetsListIntegrations 返回主页智能体分组的数据源。材料库尚不存在
// 时返回空列表而不报错。
func (a *App) SessionAssetsListIntegrations() (result connection.QueryResult) {
	a.sessionAssetsMu.Lock()
	service := a.sessionAssets
	a.sessionAssetsMu.Unlock()
	if service == nil {
		return connection.QueryResult{Success: true, Data: []sessionassets.AgentIntegrationSummary{}}
	}
	catalog := service.Catalog()
	integrations, err := catalog.ListIntegrations(context.Background())
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.list_failed", err)
	}
	summaries := make([]sessionassets.AgentIntegrationSummary, 0, len(integrations))
	for _, integration := range integrations {
		count, err := catalog.CountAssets(context.Background(), integration.ID)
		if err != nil {
			return sessionAssetsError(a, "session_assets.error.list_failed", err)
		}
		summaries = append(summaries, sessionassets.AgentIntegrationSummary{
			IntegrationID: integration.ID,
			Kind:          integration.Kind,
			DisplayName:   integration.DisplayName,
			Enabled:       integration.Enabled,
			AssetCount:    count,
		})
	}
	return connection.QueryResult{Success: true, Data: summaries}
}

// detectAgentKind 按工具类型分派探测；首版仅 Codex。
func (a *App) detectAgentKind(ctx context.Context, kind, commandPath, dataDir string) codex.Detection {
	return codex.Detect(ctx, commandPath, dataDir)
}

// findIntegrationByKind 按工具类型查找集成记录。
func (a *App) findIntegrationByKind(catalog *sessionassets.Catalog, kind string) (sessionassets.Integration, error) {
	integrations, err := catalog.ListIntegrations(context.Background())
	if err != nil {
		return sessionassets.Integration{}, err
	}
	for _, integration := range integrations {
		if integration.Kind == kind {
			return integration, nil
		}
	}
	return sessionassets.Integration{}, sessionassets.ErrNotFound
}

// buildDetectionView 合成探测与集成状态视图。
func (a *App) buildDetectionView(kind string, detection codex.Detection) sessionassets.DetectionView {
	view := sessionassets.DetectionView{
		Kind:            kind,
		DetectionStatus: detection.Status,
		CommandPath:     detection.CommandPath,
		Version:         detection.Version,
		DataDir:         detection.DataDir,
		DataReadable:    detection.DataReadable,
		Details:         detection.Details,
	}
	if materialsRoot, err := appdata.ResolveSessionAssetsDirectory(appdata.MustResolveActiveRoot()); err == nil {
		view.MaterialsRoot = materialsRoot
	}
	a.sessionAssetsMu.Lock()
	service := a.sessionAssets
	a.sessionAssetsMu.Unlock()
	if service == nil {
		if detection.Status == codex.StatusReady {
			view.IntegrationStatus = sessionassets.IntegrationStatusReadyToEnable
		} else {
			view.IntegrationStatus = detection.Status
		}
		return view
	}
	integration, err := a.findIntegrationByKind(service.Catalog(), kind)
	if errors.Is(err, sessionassets.ErrNotFound) {
		view.IntegrationStatus = sessionassets.IntegrationStatusReadyToEnable
		return view
	}
	if err != nil {
		view.IntegrationStatus = detection.Status
		return view
	}
	view.IntegrationID = integration.ID
	if integration.Enabled {
		view.IntegrationStatus = sessionassets.IntegrationStatusEnabled
	} else {
		view.IntegrationStatus = sessionassets.IntegrationStatusDisabled
	}
	return view
}

// sessionAssetsUnsupportedResult 首版仅 Codex，其他类型给出明确未支持。
func sessionAssetsUnsupportedResult(a *App, kind string) connection.QueryResult {
	return connection.QueryResult{
		Success: false,
		Message: a.appText("session_assets.error.unsupported_kind", map[string]any{"kind": kind}),
	}
}

// sessionAssetsServiceError 把服务打开失败翻译为可解释状态（含库占用）。
func sessionAssetsServiceError(a *App, err error) connection.QueryResult {
	if errors.Is(err, sessionassets.ErrLibraryLocked) {
		return connection.QueryResult{
			Success: false,
			Message: a.appText("session_assets.error.library_locked", nil),
		}
	}
	return sessionAssetsError(a, "session_assets.error.service_open_failed", err)
}

// sessionAssetsError 统一记录日志并返回 i18n 失败结果。
func sessionAssetsError(a *App, messageKey string, err error) connection.QueryResult {
	logger.Error(err, "session assets binding failed")
	return connection.QueryResult{
		Success: false,
		Message: a.appText(messageKey, map[string]any{"detail": err.Error()}),
	}
}

// agentDetectionStatusText 把探测状态码转为简短说明（不替代前端主文案）。
func (a *App) agentDetectionStatusText(status string) string {
	switch status {
	case codex.StatusNotInstalled:
		return a.appText("session_assets.detect.status.not_installed", nil)
	case codex.StatusNotInitialized:
		return a.appText("session_assets.detect.status.not_initialized", nil)
	case codex.StatusDataUnreadable:
		return a.appText("session_assets.detect.status.data_unreadable", nil)
	case codex.StatusReady:
		return a.appText("session_assets.detect.status.ready", nil)
	default:
		return fmt.Sprintf("unknown(%s)", status)
	}
}
