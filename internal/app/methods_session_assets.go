package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

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
	detection := a.cachedCodexDetection(context.Background(), kind, input.CommandPath, input.DataDir)
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
// 时返回空列表而不报错；服务未打开时先尝试补打开（启动时被其他实例占用、
// 之后锁已释放的自愈），仍失败才降级为只读列表并标记 libraryLocked，
// 分组照常显示（不静默消失）。
func (a *App) SessionAssetsListIntegrations() (result connection.QueryResult) {
	a.sessionAssetsMu.Lock()
	service := a.sessionAssets
	a.sessionAssetsMu.Unlock()
	if service == nil && sessionAssetsCatalogExists() {
		// 只对已存在的库补打开：从未启用过不得顺手创建材料库。
		if reopened, err := a.ensureSessionAssetsService(); err == nil {
			service = reopened
		}
	}
	if service == nil {
		if result, ok := a.listIntegrationsReadOnly(); ok {
			return result
		}
		return connection.QueryResult{Success: true, Data: []sessionassets.AgentIntegrationSummary{}}
	}
	integrations, err := service.Catalog().ListIntegrations(context.Background())
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.list_failed", err)
	}
	summaries, err := summarizeIntegrations(service.Catalog(), integrations, false)
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.list_failed", err)
	}
	return connection.QueryResult{Success: true, Data: summaries}
}

// summarizeIntegrations 为集成记录聚合资产数并收拢为分组视图。
func summarizeIntegrations(catalog *sessionassets.Catalog, integrations []sessionassets.Integration, locked bool) ([]sessionassets.AgentIntegrationSummary, error) {
	summaries := make([]sessionassets.AgentIntegrationSummary, 0, len(integrations))
	for _, integration := range integrations {
		count, err := catalog.CountAssets(context.Background(), integration.ID)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, sessionassets.AgentIntegrationSummary{
			IntegrationID: integration.ID,
			Kind:          integration.Kind,
			DisplayName:   integration.DisplayName,
			Enabled:       integration.Enabled,
			AssetCount:    count,
			LibraryLocked: locked,
		})
	}
	return summaries, nil
}

// sessionAssetsCatalogExists 报告材料库目录文件是否已存在；从未启用过的
// 安装没有该文件，任何路径都不得顺手创建（与 initializeSessionAssets 同一
// 判定基准）。
func sessionAssetsCatalogExists() bool {
	materialsRoot, err := appdata.ResolveSessionAssetsDirectory(appdata.MustResolveActiveRoot())
	if err != nil {
		return false
	}
	_, err = os.Stat(filepath.Join(materialsRoot, "catalog.sqlite"))
	return err == nil
}

// listIntegrationsReadOnly 在写服务不可用时以只读连接列出集成：
// 目录文件存在且可读时返回降级摘要。失败返回 false，由调用方回退空列表。
func (a *App) listIntegrationsReadOnly() (connection.QueryResult, bool) {
	materialsRoot, err := appdata.ResolveSessionAssetsDirectory(appdata.MustResolveActiveRoot())
	if err != nil {
		return connection.QueryResult{}, false
	}
	catalogPath := filepath.Join(materialsRoot, "catalog.sqlite")
	if _, err := os.Stat(catalogPath); err != nil {
		return connection.QueryResult{}, false
	}
	catalog, err := sessionassets.OpenCatalogReadOnly(catalogPath)
	if err != nil {
		logger.Warnf("会话资产目录只读打开失败：%v", err)
		return connection.QueryResult{}, false
	}
	defer catalog.Close()
	integrations, err := catalog.ListIntegrations(context.Background())
	if err != nil {
		logger.Warnf("只读列出会话资产集成失败：%v", err)
		return connection.QueryResult{}, false
	}
	summaries, err := summarizeIntegrations(catalog, integrations, true)
	if err != nil {
		logger.Warnf("只读聚合会话资产集成摘要失败：%v", err)
		return connection.QueryResult{}, false
	}
	return connection.QueryResult{Success: true, Data: summaries}, true
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

// codexProbeCacheEntry 缓存一次探测结果，避免每次选择资产都重新执行
// codex --version（Windows 上会反复创建进程）。显式重新检测绕过缓存。
type codexProbeCacheEntry struct {
	dataDir       string
	commandPath   string
	version       string
	currentProber string
	probedAt      time.Time
}

var (
	codexProbeCacheMu  sync.Mutex
	codexProbeCache    *codexProbeCacheEntry
	codexProbeCacheTTL = 5 * time.Minute
)

// cachedCodexDetection 带缓存的探测：dataDir/commandPath 与缓存一致且
// 未过期时直接返回缓存结果。
func (a *App) cachedCodexDetection(ctx context.Context, kind, commandPath, dataDir string) codex.Detection {
	codexProbeCacheMu.Lock()
	cached := codexProbeCache
	codexProbeCacheMu.Unlock()
	if cached != nil && commandPath == "" && dataDir == "" &&
		time.Since(cached.probedAt) < codexProbeCacheTTL {
		return codex.Detection{
			Kind:         kind,
			Status:       codex.StatusReady,
			CommandPath:  cached.commandPath,
			Version:      cached.version,
			DataDir:      cached.dataDir,
			DataReadable: true,
			Details:      []string{codex.DetailOK},
		}
	}
	detection := a.detectAgentKind(ctx, kind, commandPath, dataDir)
	if detection.Status == codex.StatusReady {
		codexProbeCacheMu.Lock()
		codexProbeCache = &codexProbeCacheEntry{
			dataDir:     detection.DataDir,
			commandPath: detection.CommandPath,
			version:     detection.Version,
			probedAt:    time.Now(),
		}
		codexProbeCacheMu.Unlock()
	}
	return detection
}
