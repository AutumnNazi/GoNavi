package app

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"GoNavi-Wails/internal/connection"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 单次文本导出的内容上限：对比报告是纯文本产物，正常远小于此。
const maxExportedTextBytes = 20 * 1024 * 1024

var errExportedTextTooLarge = errors.New("exported text is too large")

// exportTextFormats 只放「纯文本可交付」的扩展名，避免这个通用出口
// 变成任意二进制写盘通道。
var exportTextFormats = map[string]struct{}{
	"html": {},
	"md":   {},
	"txt":  {},
	"json": {},
	"csv":  {},
}

func normalizeExportTextFormat(format string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(format))
	if normalized == "" {
		normalized = "txt"
	}
	if _, ok := exportTextFormats[normalized]; !ok {
		return "", fmt.Errorf("unsupported text export format: %s", format)
	}
	return normalized, nil
}

func buildExportedTextFileName(defaultName string, format string) string {
	// sanitizeExportFileStem 会把空名换成 "export"，这里要的是可区分的时间戳，
	// 所以在洗净前就判断是否真的没有名字。
	stem := fmt.Sprintf("gonavi-export-%s", time.Now().Format("20060102-150405"))
	if strings.TrimSpace(defaultName) != "" {
		stem = sanitizeExportFileStem(defaultName)
	}
	return stem + exportFormatExtension(format)
}

// ExportTextFile 把调用方已经渲染好的文本写成文件。桌面端弹保存对话框，
// Web 端交给下载通道，两边都不改内容，渲染只发生在前端。
func (a *App) ExportTextFile(defaultName string, content string, format string) (result connection.QueryResult) {
	if a == nil {
		return connection.QueryResult{Success: false, Message: "application is unavailable"}
	}
	normalizedFormat, err := normalizeExportTextFormat(format)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	if int64(len(content)) > maxExportedTextBytes {
		return connection.QueryResult{Success: false, Message: errExportedTextTooLarge.Error()}
	}
	fileName := buildExportedTextFileName(defaultName, normalizedFormat)

	var webTarget *webDownloadTarget
	target := ""
	if a.webRuntime {
		webTarget, err = a.newWebDownloadTarget(fileName, webDownloadMIMEForFormat(normalizedFormat))
		if err != nil {
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		target = webTarget.path
		defer func() { result = webTarget.finish(result) }()
	} else {
		target, err = a.showSaveFileDialog(runtime.SaveDialogOptions{
			Title:           a.appText("file.backend.dialog.export_data", nil),
			DefaultFilename: fileName,
			Filters:         exportFileDialogFilters(normalizedFormat),
		})
		if err != nil {
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		if strings.TrimSpace(target) == "" {
			return connection.QueryResult{Success: false, Message: "已取消"}
		}
		target, err = a.resolveExportDialogTargetPath(target, normalizedFormat)
		if err != nil {
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
	}

	if err := writeSQLAuditExportAtomically(target, []byte(content)); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	if webTarget != nil {
		// Web 目标由 finish 统一补齐下载描述，这里只报告文件名。
		return connection.QueryResult{Success: true, Data: map[string]string{
			"fileName": filepath.Base(fileName),
		}}
	}
	return connection.QueryResult{Success: true, Data: map[string]string{"path": target}}
}
