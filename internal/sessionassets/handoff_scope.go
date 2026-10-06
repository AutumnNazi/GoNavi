package sessionassets

import (
	"context"
	"fmt"
	"path/filepath"
)

// HandoffScope 是两阶段新建第一阶段的选择结果（交互设计 §6）。
// Mode: all = 全部可读历史；recent = 最近可读轮次；custom = 显式行范围。
type HandoffScope struct {
	Mode string `json:"mode"`
	From int    `json:"from"`
	To   int    `json:"to"`
}

// 交接范围模式。
const (
	HandoffScopeAll    = "all"
	HandoffScopeRecent = "recent"
	HandoffScopeCustom = "custom"
)

// HistoryStatsView 是范围预览统计（adapter 扫描后转换；不估算 token，
// FR-18：预算未知时不造精确数字）。
type HistoryStatsView struct {
	TotalLines   int `json:"totalLines"`
	Messages     int `json:"messages"`
	ToolCalls    int `json:"toolCalls"`
	ToolOutputs  int `json:"toolOutputs"`
	Opaque       int `json:"opaque"`
	LastUserLine int `json:"lastUserLine"`
}

// HistoryStatsScanner 是统计能力接口（adapter 实现）。
type HistoryStatsScanner interface {
	ScanReadableStats(ctx context.Context, path string) (HistoryStatsView, error)
}

// NormalizeHandoffScope 校验范围选择；非法输入回落到最近可读轮次
// （D-08：长历史不能默认无界）。
func NormalizeHandoffScope(mode string, from, to int) HandoffScope {
	switch mode {
	case HandoffScopeAll:
		return HandoffScope{Mode: HandoffScopeAll}
	case HandoffScopeCustom:
		if from >= 0 && to >= from {
			return HandoffScope{Mode: HandoffScopeCustom, From: from, To: to}
		}
	}
	return HandoffScope{Mode: HandoffScopeRecent}
}

// PreviewHandoff 生成两阶段第二阶段的预览数据：解析后的行区间、条目
// 统计与省略说明。
func (s *Service) PreviewHandoff(ctx context.Context, detail AssetDetail, scope HandoffScope, scanner HistoryStatsScanner) (map[string]any, error) {
	if !detail.HasReadableHistory() {
		return nil, ErrNoReadableHistory
	}
	normalized := NormalizeHandoffScope(scope.Mode, scope.From, scope.To)
	result := map[string]any{
		"mode":       normalized.Mode,
		"from":       normalized.From,
		"to":         normalized.To,
		"budgetNote": "unknown",
	}
	if scanner == nil {
		return result, nil
	}
	stats, err := scanner.ScanReadableStats(ctx, detail.ReadPath)
	if err != nil {
		// 统计失败不阻断预览，如实缺失说明。
		result["statsUnavailable"] = true
		return result, nil
	}
	from, to := resolveScopeRange(normalized, stats)
	result["stats"] = stats
	result["resolvedFrom"] = from
	result["resolvedTo"] = to
	if stats.Opaque > 0 {
		result["omissions"] = fmt.Sprintf("%d opaque entries stay in raw material only", stats.Opaque)
	}
	return result, nil
}

// resolveScopeRange 把范围模式解析为实际行区间（含端点；-1 表示到末尾）。
func resolveScopeRange(scope HandoffScope, stats HistoryStatsView) (int, int) {
	switch scope.Mode {
	case HandoffScopeAll:
		return 0, stats.TotalLines - 1
	case HandoffScopeCustom:
		return scope.From, scope.To
	default:
		if stats.LastUserLine < 0 {
			return 0, stats.TotalLines - 1
		}
		return stats.LastUserLine, stats.TotalLines - 1
	}
}

// WriteScopedReadableExport 把选定范围的可读历史写入交接材料目录。
// reader 由 adapter 提供；header 携带来源说明。
func (s *Service) WriteScopedReadableExport(ctx context.Context, detail AssetDetail, materialsDir string, from, to int, reader ReadableHistoryReader) (string, error) {
	target := filepath.Join(materialsDir, "readable-history.md")
	header := map[string]string{
		"title":      detailTitleOrID(detail),
		"thread":     detail.NativeThreadID,
		"provider":   emptyDash(detail.Provider),
		"project":    emptyDash(detail.ProjectDir),
		"readSource": detail.ReadSource,
		"scope":      fmt.Sprintf("lines %d..%d", from, to),
	}
	if detail.CoverageAt > 0 {
		header["coverage"] = FormatCoverageTime(detail.CoverageAt)
	}
	return target, WriteReadableMarkdown(ctx, reader, detail.ReadPath, target, from, to, header)
}
