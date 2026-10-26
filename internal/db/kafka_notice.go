package db

import (
	"fmt"
	"strconv"
	"strings"
)

// Kafka 驱动返回给主进程的提示信息。驱动跑在 agent 进程里，不知道界面语言，
// 所以只返回机器可读的标记，由主进程按当前语言渲染。此文件不带构建标签：
// 主进程在 lite 构建下也要能识别标记。
const kafkaPreviewTruncatedNoticePrefix = "gonavi:notice:kafka.preview_truncated"

// FormatKafkaPreviewTruncatedNotice 生成「预览因字节预算提前停止」的标记。
func FormatKafkaPreviewTruncatedNotice(rows int, budgetBytes int64) string {
	return fmt.Sprintf("%s rows=%d budget=%d", kafkaPreviewTruncatedNoticePrefix, rows, budgetBytes)
}

// ParseKafkaPreviewTruncatedNotice 解析 FormatKafkaPreviewTruncatedNotice 生成的标记。
func ParseKafkaPreviewTruncatedNotice(message string) (rows int, budgetBytes int64, ok bool) {
	rest, found := strings.CutPrefix(strings.TrimSpace(message), kafkaPreviewTruncatedNoticePrefix)
	if !found {
		return 0, 0, false
	}
	for _, field := range strings.Fields(rest) {
		name, value, hasValue := strings.Cut(field, "=")
		if !hasValue {
			continue
		}
		switch name {
		case "rows":
			rows, _ = strconv.Atoi(value)
		case "budget":
			budgetBytes, _ = strconv.ParseInt(value, 10, 64)
		}
	}
	return rows, budgetBytes, true
}
