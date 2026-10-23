package app

import (
	"fmt"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

// localizeQueryResultNotices 渲染查询结果里的驱动提示（顶层与各结果集），供各查询入口 defer 调用。
// 驱动可能跑在 agent 进程里，不知道界面语言，只能返回标记；入口统一在返回前替换。
func (a *App) localizeQueryResultNotices(result *connection.QueryResult) {
	if result == nil {
		return
	}
	result.Messages = a.localizeDriverNotices(result.Messages)
	resultSets, ok := result.Data.([]connection.ResultSetData)
	if !ok {
		return
	}
	for i := range resultSets {
		resultSets[i].Messages = a.localizeDriverNotices(resultSets[i].Messages)
	}
}

// localizeDriverNotices 把驱动返回的机器可读提示渲染成当前界面语言，其他提示原样保留。
// 没有需要替换的提示时返回原切片，不额外分配。
func (a *App) localizeDriverNotices(messages []string) []string {
	var localized []string
	for i, message := range messages {
		rows, budget, ok := db.ParseKafkaPreviewTruncatedNotice(message)
		if !ok {
			continue
		}
		if localized == nil {
			localized = append([]string(nil), messages...)
		}
		localized[i] = a.appText("db.backend.message.kafka_preview_truncated", map[string]any{
			"rows":   rows,
			"budget": formatNoticeMiB(budget),
		})
	}
	if localized == nil {
		return messages
	}
	return localized
}

func formatNoticeMiB(bytes int64) string {
	return fmt.Sprintf("%d MiB", bytes>>20)
}
