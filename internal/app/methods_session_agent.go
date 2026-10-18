package app

import (
	"strings"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/sessionagent"
)

// 智能体会话管理的 Wails 绑定：扫描列表、详情、按需内容、导出、
// 删除、复制恢复命令。绑定层只做参数校验与 QueryResult 收拢，
// 领域规则在 sessionagent（GO_STYLE §3）。
//
// 方案参考 cc-switch 会话管理器（MIT）：纯只读浏览本地 CLI 会话。

// sessionAgentService 返回会话浏览服务（轻量无状态，随用随建）。
func (a *App) sessionAgentService() *sessionagent.Service {
	return sessionagent.New()
}

// SessionAgentList 返回会话列表（按最后活跃时间倒序）。provider 为空
// 返回全部工具；search 对标题/摘要/项目/会话 ID 子串匹配。
func (a *App) SessionAgentList(provider, search string) (result connection.QueryResult) {
	defer func() {
		if rec := recover(); rec != nil {
			logger.Errorf("SessionAgentList panic: %v", rec)
			result = connection.QueryResult{Success: false, Message: a.appText("session_agent.error.list_failed", nil)}
		}
	}()
	items := a.sessionAgentService().List(provider, search)
	return connection.QueryResult{Success: true, Data: map[string]any{
		"items": items,
		"total": len(items),
	}}
}

// SessionAgentProviders 返回支持的工具列表（Codex + Claude Code）。
func (a *App) SessionAgentProviders() (result connection.QueryResult) {
	return connection.QueryResult{Success: true, Data: a.sessionAgentService().ListProviders()}
}

// SessionAgentDetail 返回会话详情：消息流、轮次索引与缓存命中标记。
func (a *App) SessionAgentDetail(provider, sourcePath string) (result connection.QueryResult) {
	defer func() {
		if rec := recover(); rec != nil {
			logger.Errorf("SessionAgentDetail panic: %v", rec)
			result = connection.QueryResult{Success: false, Message: a.appText("session_agent.error.detail_failed", nil)}
		}
	}()
	provider, sourcePath = strings.TrimSpace(provider), strings.TrimSpace(sourcePath)
	if provider == "" || sourcePath == "" {
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.detail_failed", nil)}
	}
	transcript, cached, err := a.sessionAgentService().LoadTranscript(provider, sourcePath)
	if err != nil {
		logger.Error(err, "SessionAgentDetail failed")
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.detail_failed", map[string]any{"detail": err.Error()})}
	}
	return connection.QueryResult{Success: true, Data: map[string]any{
		"messages": transcript.Messages,
		"turns":    transcript.Turns,
		"cached":   cached,
	}}
}

// SessionAgentReadPage 按消息下标分页读取会话消息。
func (a *App) SessionAgentReadPage(provider, sourcePath string, offset, limit int) (result connection.QueryResult) {
	provider, sourcePath = strings.TrimSpace(provider), strings.TrimSpace(sourcePath)
	if provider == "" || sourcePath == "" {
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.detail_failed", nil)}
	}
	messages, err := a.sessionAgentService().ReadPage(provider, sourcePath, offset, limit)
	if err != nil {
		logger.Error(err, "SessionAgentReadPage failed")
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.detail_failed", map[string]any{"detail": err.Error()})}
	}
	return connection.QueryResult{Success: true, Data: map[string]any{"messages": messages}}
}

// SessionAgentBlockContent 按需取大内容（分页）。
func (a *App) SessionAgentBlockContent(provider, sourcePath string, ref sessionagent.ContentRef, offset, limit int) (result connection.QueryResult) {
	provider, sourcePath = strings.TrimSpace(provider), strings.TrimSpace(sourcePath)
	if provider == "" || sourcePath == "" {
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.content_failed", nil)}
	}
	content, err := a.sessionAgentService().BlockContent(provider, sourcePath, ref, offset, limit)
	if err != nil {
		logger.Error(err, "SessionAgentBlockContent failed")
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.content_failed", map[string]any{"detail": err.Error()})}
	}
	return connection.QueryResult{Success: true, Data: content}
}

// SessionAgentExportMarkdown 把会话导出为 Markdown 文本。
func (a *App) SessionAgentExportMarkdown(provider, sourcePath string) (result connection.QueryResult) {
	provider, sourcePath = strings.TrimSpace(provider), strings.TrimSpace(sourcePath)
	if provider == "" || sourcePath == "" {
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.export_failed", nil)}
	}
	markdown, err := a.sessionAgentService().ExportMarkdown(provider, sourcePath)
	if err != nil {
		logger.Error(err, "SessionAgentExportMarkdown failed")
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.export_failed", map[string]any{"detail": err.Error()})}
	}
	return connection.QueryResult{Success: true, Data: map[string]any{"markdown": markdown}}
}

// SessionAgentCopyResume 返回恢复命令（前端复制到剪贴板）。
func (a *App) SessionAgentCopyResume(provider, sessionID string) (result connection.QueryResult) {
	command := a.sessionAgentService().ResumeCommand(strings.TrimSpace(provider), strings.TrimSpace(sessionID))
	if command == "" {
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.resume_unavailable", nil)}
	}
	return connection.QueryResult{Success: true, Data: map[string]any{"command": command}}
}

// SessionAgentDelete 删除会话记录文件（含身份校验与双形态联动）。
func (a *App) SessionAgentDelete(provider, sourcePath, sessionID string) (result connection.QueryResult) {
	provider, sourcePath, sessionID = strings.TrimSpace(provider), strings.TrimSpace(sourcePath), strings.TrimSpace(sessionID)
	if provider == "" || sourcePath == "" || sessionID == "" {
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.delete_failed", nil)}
	}
	if err := a.sessionAgentService().Delete(provider, sourcePath, sessionID); err != nil {
		logger.Error(err, "SessionAgentDelete failed")
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.delete_failed", map[string]any{"detail": err.Error()})}
	}
	return connection.QueryResult{Success: true}
}

// SessionAgentRevealPath 返回文件所在目录（前端打开资源管理器）。
func (a *App) SessionAgentRevealPath(sourcePath string) (result connection.QueryResult) {
	path := sessionagent.RevealPath(strings.TrimSpace(sourcePath))
	if path == "" {
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.reveal_failed", nil)}
	}
	return connection.QueryResult{Success: true, Data: map[string]any{"path": path}}
}

// SessionAgentTimeGroups 返回按时间分组的会话列表（今天/昨天/本周/
// 更早），供前端分组展示。
func (a *App) SessionAgentTimeGroups(provider, search string) (result connection.QueryResult) {
	items := a.sessionAgentService().List(provider, search)
	groups := sessionagent.GroupByTime(items, nowForSessionAgent())
	return connection.QueryResult{Success: true, Data: map[string]any{
		"groups": groups,
		"total":  len(items),
	}}
}

// nowForSessionAgent 抽出时间以便测试注入。
var nowForSessionAgent = func() time.Time { return time.Now() }
