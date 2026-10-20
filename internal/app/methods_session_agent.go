package app

import (
	"context"
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

// sessionAgentService 返回会话浏览服务：按已添加的智能体实例注入
// 各工具数据目录，未添加的工具不参与扫描。
func (a *App) sessionAgentService() *sessionagent.Service {
	service := sessionagent.New()
	integrations, err := a.ListAgentIntegrations()
	if err != nil {
		// 配置不可读时退化为「无已添加」：显式置空启用集，
		// 避免 isEnabled 的 nil 宽松语义放行默认目录扫描。
		service.SetEnabled()
		return service
	}
	for _, item := range integrations {
		switch item.Kind {
		case sessionagent.ProviderCodex:
			service.CodexDir = item.DataDir
		case sessionagent.ProviderClaude:
			service.ClaudeDir = item.DataDir
		}
	}
	return service
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
	if items == nil {
		// Go nil slice 序列化为 JSON null；前端按数组消费，这里归一。
		items = []sessionagent.SessionMeta{}
	}
	return connection.QueryResult{Success: true, Data: map[string]any{
		"items": items,
		"total": len(items),
	}}
}

// SessionAgentListIntegrations 返回已添加的智能体（读 agents.json）。
// 空列表表示尚未添加任何智能体：侧边栏分组隐藏，入口在新建连接弹窗。
func (a *App) SessionAgentListIntegrations() (result connection.QueryResult) {
	integrations, err := a.ListAgentIntegrations()
	if err != nil {
		logger.Error(err, "SessionAgentListIntegrations failed")
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.list_integrations_failed", map[string]any{"detail": err.Error()})}
	}
	if integrations == nil {
		integrations = []AgentIntegration{}
	}
	return connection.QueryResult{Success: true, Data: integrations}
}

// SessionAgentDetect 探测本机安装（添加前的扫描）：命令路径、版本与
// 数据目录可读性。ctx 由 Wails 注入用户请求上下文（GO_STYLE §4），
// 窗口关闭/请求取消可中断 --version 探测。
func (a *App) SessionAgentDetect(ctx context.Context, kind, dataDir string) (result connection.QueryResult) {
	detection := sessionagent.Detect(ctx, strings.TrimSpace(kind), strings.TrimSpace(dataDir))
	return connection.QueryResult{Success: true, Data: detection}
}

// SessionAgentAdd 二次确认后添加智能体实例（写 agents.json）。同 kind
// 已存在时报错。
func (a *App) SessionAgentAdd(kind, dataDir string) (result connection.QueryResult) {
	added, err := a.AddAgentIntegration(strings.TrimSpace(kind), strings.TrimSpace(dataDir), "")
	if err != nil {
		logger.Error(err, "SessionAgentAdd failed")
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.add_failed", map[string]any{"detail": err.Error()})}
	}
	return connection.QueryResult{Success: true, Data: added}
}

// SessionAgentRemove 移除已添加的智能体（只删配置）。
func (a *App) SessionAgentRemove(kind string) (result connection.QueryResult) {
	if err := a.RemoveAgentIntegration(strings.TrimSpace(kind)); err != nil {
		logger.Error(err, "SessionAgentRemove failed")
		return connection.QueryResult{Success: false, Message: a.appText("session_agent.error.remove_failed", map[string]any{"detail": err.Error()})}
	}
	return connection.QueryResult{Success: true}
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
