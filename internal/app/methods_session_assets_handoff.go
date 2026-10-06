package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/sessionassets"
	"GoNavi-Wails/internal/sessionassets/adapters/codex"
)

// 会话交接绑定：原生继续（CLI 优先）与手动材料兜底。结果分级报告：
// 材料就绪、入口已启动、会话已创建、轮执行完成是不同状态（FR-15/FR-22，
// V-29）；首版自动路径最高只到“入口已启动”。

// SessionAssetsContinueSession 在系统终端以官方 CLI 原生续聊原会话。
// 仅同 provider 尽力而为：入口启动不代表会话受理或执行成功。
func (a *App) SessionAssetsContinueSession(assetID string) (result connection.QueryResult) {
	_, service, err := a.sessionAssetsCatalog()
	if err != nil {
		return sessionAssetsServiceError(a, err)
	}
	detail, err := service.AssetDetail(context.Background(), assetID)
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.list_failed", err)
	}
	if !sessionassets.CanResumeNatively(detail, codex.CurrentProvider(sourceDataDirForProviderProbe(detail))) {
		return connection.QueryResult{
			Success: false,
			Message: a.appText("session_assets.error.resume_unavailable", nil),
			Data:    map[string]any{"stage": sessionassets.HandoffStageFailed},
		}
	}
	detection := codex.Detect(context.Background(), "", "")
	if detection.Status != codex.StatusReady || detection.CommandPath == "" {
		return connection.QueryResult{
			Success: false,
			Message: a.appText("session_assets.error.detect_not_ready", map[string]any{
				"status": a.agentDetectionStatusText(detection.Status),
			}),
			Data: map[string]any{"stage": sessionassets.HandoffStageFailed},
		}
	}
	// provider guard（S-15/AC-12）：历史 provider 与当前运行 provider 不一致
	// 时拒绝原生续聊，改走携带历史新建，避免改写或误路由。
	currentProvider := codex.CurrentProvider(detection.DataDir)
	if strings.TrimSpace(detail.Provider) != "" && strings.TrimSpace(currentProvider) != "" &&
		!strings.EqualFold(detail.Provider, currentProvider) {
		return connection.QueryResult{
			Success: false,
			Message: a.appText("session_assets.error.provider_mismatch", map[string]any{
				"history": detail.Provider,
				"current": currentProvider,
			}),
			Data: map[string]any{
				"stage":           sessionassets.HandoffStageFailed,
				"historyProvider": detail.Provider,
				"currentProvider": currentProvider,
			},
		}
	}
	command := fmt.Sprintf("%s resume %s", quoteCommand(detection.CommandPath), detail.NativeThreadID)
	if err := sessionassets.LaunchTerminal(context.Background(), command, detail.ProjectDir); err != nil {
		return sessionAssetsError(a, "session_assets.error.launch_failed", err)
	}
	logger.Infof("会话资产：原生续聊入口已启动 asset=%s", assetID)
	return connection.QueryResult{Success: true, Data: map[string]any{
		"stage":   sessionassets.HandoffStageEntryLaunched,
		"command": command,
		"workDir": detail.ProjectDir,
	}}
}

// SessionAssetsLaunchInteractive 在指定工作目录启动 Codex 交互模式，
// 用于携带材料的新会话。启动不代表新会话已创建。
func (a *App) SessionAssetsLaunchInteractive(workDir string) (result connection.QueryResult) {
	detection := codex.Detect(context.Background(), "", "")
	if detection.Status != codex.StatusReady || detection.CommandPath == "" {
		return connection.QueryResult{
			Success: false,
			Message: a.appText("session_assets.error.detect_not_ready", map[string]any{
				"status": a.agentDetectionStatusText(detection.Status),
			}),
			Data: map[string]any{"stage": sessionassets.HandoffStageFailed},
		}
	}
	command := quoteCommand(detection.CommandPath)
	if err := sessionassets.LaunchTerminal(context.Background(), command, strings.TrimSpace(workDir)); err != nil {
		return sessionAssetsError(a, "session_assets.error.launch_failed", err)
	}
	return connection.QueryResult{Success: true, Data: map[string]any{
		"stage":   sessionassets.HandoffStageEntryLaunched,
		"command": command,
		"workDir": strings.TrimSpace(workDir),
	}}
}

// SessionAssetsPrepareHandoff 生成手动交接材料包与核验过的操作说明
// （手动兜底必需可用，FR-22）。
func (a *App) SessionAssetsPrepareHandoff(assetID, workDir, scopeMode string, from, to int, currentRequest string) (result connection.QueryResult) {
	_, service, err := a.sessionAssetsCatalog()
	if err != nil {
		return sessionAssetsServiceError(a, err)
	}
	detail, err := service.AssetDetail(context.Background(), assetID)
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.list_failed", err)
	}
	scope := sessionassets.NormalizeHandoffScope(scopeMode, from, to)
	plan, err := service.PrepareHandoffMaterials(context.Background(), detail, workDir, scope, currentRequest, codex.ReadableHistoryAdapter{}, codex.ReadableHistoryAdapter{})
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.handoff_failed", err)
	}
	if plan.Stage == sessionassets.HandoffStageFailed {
		return connection.QueryResult{
			Success: false,
			Message: a.appText("session_assets.error.handoff_no_material", nil),
			Data:    plan,
		}
	}
	return connection.QueryResult{Success: true, Data: plan}
}

// SessionAssetsHandoffCapability 返回资产当前可用的交接能力，供前端
// 决定按钮与降级路径（交互设计 §5.1 动作表）。
func (a *App) SessionAssetsHandoffCapability(assetID string) (result connection.QueryResult) {
	_, service, err := a.sessionAssetsCatalog()
	if err != nil {
		return sessionAssetsServiceError(a, err)
	}
	detail, err := service.AssetDetail(context.Background(), assetID)
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.list_failed", err)
	}
	detection := codex.Detect(context.Background(), "", "")
	capability := map[string]any{
		"nativeResume":    sessionassets.CanResumeNatively(detail, codex.CurrentProvider(detection.DataDir)) && detection.CommandPath != "",
		"historyProvider": detail.Provider,
		"currentProvider": codex.CurrentProvider(detection.DataDir),
		"newSession":      detection.CommandPath != "",
		"manualMaterial":  detail.LatestGenerationID != "",
		"cliVersion":      detection.Version,
	}
	return connection.QueryResult{Success: true, Data: capability}
}

// quoteCommand 为含空格的命令路径加引号（Windows 空格路径）。
func quoteCommand(commandPath string) string {
	trimmed := strings.TrimSpace(commandPath)
	if strings.ContainsAny(trimmed, " \t") && !strings.HasPrefix(trimmed, "\"") {
		return "\"" + trimmed + "\""
	}
	return trimmed
}

// SessionAssetsPreviewHandoff 返回两阶段新建第二阶段的预览数据：解析后
// 的行区间、条目统计与省略说明（不估算 token，FR-18）。
func (a *App) SessionAssetsPreviewHandoff(assetID, scopeMode string, from, to int) (result connection.QueryResult) {
	_, service, err := a.sessionAssetsCatalog()
	if err != nil {
		return sessionAssetsServiceError(a, err)
	}
	detail, err := service.AssetDetail(context.Background(), assetID)
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.list_failed", err)
	}
	scope := sessionassets.NormalizeHandoffScope(scopeMode, from, to)
	preview, err := service.PreviewHandoff(context.Background(), detail, scope, codex.ReadableHistoryAdapter{})
	if err != nil {
		return connection.QueryResult{
			Success: false,
			Message: a.appText("session_assets.error.no_readable_history", nil),
		}
	}
	return connection.QueryResult{Success: true, Data: preview}
}

// sourceDataDirForProviderProbe 从来源引用推断探测用数据目录：取第一
// 个可读来源路径所在的数据目录（向上查找 .codex 目录）；找不到回退
// ~/.codex（CurrentProvider 自行处理空值）。
func sourceDataDirForProviderProbe(detail sessionassets.AssetDetail) string {
	for _, ref := range detail.SourceRefs {
		dir := filepath.Dir(ref.NativePath)
		for i := 0; i < 6 && strings.TrimSpace(dir) != ""; i++ {
			if strings.HasSuffix(strings.ToLower(filepath.Base(dir)), ".codex") {
				return dir
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".codex")
}
