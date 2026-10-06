package app

import (
	"archive/zip"
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/sessionassets"
	"GoNavi-Wails/internal/sessionassets/adapters/codex"
)

// 会话资产读取、导出与删除的 Wails 绑定。绑定层只做参数校验与结果
// 收拢；读源判定、分页与导出组装在领域层（GO_STYLE §13）。

// SessionAssetsListAssets 返回筛选分页后的会话列表。
func (a *App) SessionAssetsListAssets(kind string, filter sessionassets.AssetFilter) (result connection.QueryResult) {
	normalized, supported := sessionassets.NormalizeAgentKind(kind)
	if !supported {
		return sessionAssetsUnsupportedResult(a, kind)
	}
	catalog, _, err := a.sessionAssetsCatalog()
	if err != nil {
		return sessionAssetsServiceError(a, err)
	}
	integration, err := a.findIntegrationByKind(catalog, normalized)
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.integration_not_found", err)
	}
	views, total, err := sessionAssetsService(a).ListAssetsView(context.Background(), integration.ID, filter)
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.list_failed", err)
	}
	return connection.QueryResult{Success: true, Data: map[string]any{
		"items": views,
		"total": total,
	}}
}

// sessionAssetsService 返回已打开的服务（调用方保证目录存在）。
func sessionAssetsService(a *App) *sessionassets.Service {
	a.sessionAssetsMu.Lock()
	defer a.sessionAssetsMu.Unlock()
	return a.sessionAssets
}

// SessionAssetsGetAssetDetail 返回详情：读源带、覆盖时间与材料清单。
func (a *App) SessionAssetsGetAssetDetail(assetID string) (result connection.QueryResult) {
	if strings.TrimSpace(assetID) == "" {
		return connection.QueryResult{Success: false, Message: a.appText("session_assets.error.integration_not_found", nil)}
	}
	_, service, err := a.sessionAssetsCatalog()
	if err != nil {
		return sessionAssetsServiceError(a, err)
	}
	detail, err := service.AssetDetail(context.Background(), assetID)
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.list_failed", err)
	}
	return connection.QueryResult{Success: true, Data: detail}
}

// SessionAssetsReadHistory 按条目分页读取历史：原源可读时读原源，
// 否则读 latest 副本（详情的读源带决定，前端先取详情再读历史）。
func (a *App) SessionAssetsReadHistory(assetID string, offset, limit int) (result connection.QueryResult) {
	if strings.TrimSpace(assetID) == "" || limit <= 0 || limit > 500 {
		return connection.QueryResult{Success: false, Message: a.appText("session_assets.error.invalid_history_range", nil)}
	}
	_, service, err := a.sessionAssetsCatalog()
	if err != nil {
		return sessionAssetsServiceError(a, err)
	}
	detail, err := service.AssetDetail(context.Background(), assetID)
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.list_failed", err)
	}
	if !detail.HasReadableHistory() {
		return connection.QueryResult{Success: false, Message: a.appText("session_assets.error.no_readable_history", nil)}
	}
	page, err := codex.ReadHistoryPage(context.Background(), detail.ReadPath, offset, limit)
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.read_failed", err)
	}
	return connection.QueryResult{Success: true, Data: map[string]any{
		"entries":    page.Entries,
		"nextOffset": page.NextOffset,
		"hasMore":    page.HasMore,
		"readSource": detail.ReadSource,
	}}
}

// SessionAssetsExportAsset 导出：raw 打包提交代次的完整材料集合；
// readable 写出全部可读条目的 Markdown。都不包含认证文件。
func (a *App) SessionAssetsExportAsset(assetID, mode, destDir string) (result connection.QueryResult) {
	trimmedDest := strings.TrimSpace(destDir)
	if strings.TrimSpace(assetID) == "" {
		return connection.QueryResult{Success: false, Message: a.appText("session_assets.error.export_failed", map[string]any{"detail": "missing asset"})}
	}
	if trimmedDest == "" {
		selection, err := openSessionAssetsDirectoryDialog(a, a.appText("session_assets.export.dialog_title", nil))
		if err != nil {
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		trimmedDest = strings.TrimSpace(selection)
		if trimmedDest == "" {
			return connection.QueryResult{Success: false, Message: "cancelled"}
		}
	}
	_, service, err := a.sessionAssetsCatalog()
	if err != nil {
		return sessionAssetsServiceError(a, err)
	}
	detail, err := service.AssetDetail(context.Background(), assetID)
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.list_failed", err)
	}
	switch strings.TrimSpace(mode) {
	case "raw":
		return a.exportRawAsset(service, detail, trimmedDest)
	case "readable":
		return a.exportReadableHistory(service, detail, trimmedDest)
	default:
		return connection.QueryResult{Success: false, Message: a.appText("session_assets.error.export_failed", map[string]any{"detail": "unknown mode"})}
	}
}

// exportRawAsset 把提交代次目录打包为 zip：自包含原始材料集合（FR-19）。
func (a *App) exportRawAsset(service *sessionassets.Service, detail sessionassets.AssetDetail, destDir string) connection.QueryResult {
	if detail.LatestGenerationID == "" {
		return connection.QueryResult{Success: false, Message: a.appText("session_assets.error.no_readable_history", nil)}
	}
	generationDir := service.Paths().GenerationDir(detail.ID, detail.LatestGenerationID)
	name := fmt.Sprintf("session-assets-%s-%s.zip", shortID(detail.ID), shortID(detail.LatestGenerationID))
	target := filepath.Join(destDir, name)
	if err := zipGenerationDir(generationDir, target); err != nil {
		return sessionAssetsError(a, "session_assets.error.export_failed", err)
	}
	return connection.QueryResult{Success: true, Data: map[string]any{"file": target, "mode": "raw"}}
}

// exportReadableHistory 把全部可读条目写成 Markdown（长历史流式写出）。
func (a *App) exportReadableHistory(service *sessionassets.Service, detail sessionassets.AssetDetail, destDir string) connection.QueryResult {
	if !detail.HasReadableHistory() {
		return connection.QueryResult{Success: false, Message: a.appText("session_assets.error.no_readable_history", nil)}
	}
	name := fmt.Sprintf("session-history-%s.md", shortID(detail.ID))
	target := filepath.Join(destDir, name)
	if err := writeReadableMarkdown(detail, target); err != nil {
		return sessionAssetsError(a, "session_assets.error.export_failed", err)
	}
	return connection.QueryResult{Success: true, Data: map[string]any{"file": target, "mode": "readable"}}
}

// zipGenerationDir 把代次目录整体打包；固定条目前缀避免路径逃逸。
func zipGenerationDir(generationDir, target string) error {
	entries, err := walkGenerationFiles(generationDir)
	if err != nil {
		return err
	}
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create export archive: %w", err)
	}
	writer := zip.NewWriter(out)
	for _, relPath := range entries {
		info, err := os.Stat(filepath.Join(generationDir, relPath))
		if err != nil {
			_ = writer.Close()
			_ = out.Close()
			return fmt.Errorf("stat export entry: %w", err)
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			_ = writer.Close()
			_ = out.Close()
			return fmt.Errorf("prepare export entry: %w", err)
		}
		header.Name = filepath.ToSlash(filepath.Join("session-assets", relPath))
		header.Method = zip.Deflate
		entry, err := writer.CreateHeader(header)
		if err != nil {
			_ = writer.Close()
			_ = out.Close()
			return fmt.Errorf("create export entry: %w", err)
		}
		payload, err := os.Open(filepath.Join(generationDir, relPath))
		if err != nil {
			_ = writer.Close()
			_ = out.Close()
			return fmt.Errorf("open export source: %w", err)
		}
		_, copyErr := io.Copy(entry, payload)
		closeErr := payload.Close()
		if copyErr != nil {
			_ = writer.Close()
			_ = out.Close()
			return fmt.Errorf("copy export entry: %w", copyErr)
		}
		if closeErr != nil {
			_ = writer.Close()
			_ = out.Close()
			return fmt.Errorf("close export source: %w", closeErr)
		}
	}
	if err := writer.Close(); err != nil {
		_ = out.Close()
		return fmt.Errorf("finalize export archive: %w", err)
	}
	if err := out.Sync(); err != nil {
		_ = out.Close()
		return fmt.Errorf("sync export archive: %w", err)
	}
	return out.Close()
}

// writeReadableMarkdown 流式写出可读历史；密文与未知条目按不透明呈现，
// 不伪造内容。
func writeReadableMarkdown(detail sessionassets.AssetDetail, target string) error {
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create readable export: %w", err)
	}
	writer := bufio.NewWriter(file)
	defer func() { _ = file.Close() }()
	fmt.Fprintf(writer, "# %s\n\n", nonEmptyText(detail.Title, detail.NativeThreadID))
	fmt.Fprintf(writer, "- thread: %s\n", detail.NativeThreadID)
	fmt.Fprintf(writer, "- provider: %s\n", nonEmptyText(detail.Provider, "-"))
	fmt.Fprintf(writer, "- project: %s\n", nonEmptyText(detail.ProjectDir, "-"))
	fmt.Fprintf(writer, "- read source: %s\n", detail.ReadSource)
	if detail.CoverageAt > 0 {
		fmt.Fprintf(writer, "- coverage: %s\n", time.Unix(detail.CoverageAt, 0).Format(time.RFC3339))
	}
	writer.WriteString("\n---\n\n")
	offset := 0
	const pageSize = 200
	for {
		page, err := codex.ReadHistoryPage(context.Background(), detail.ReadPath, offset, pageSize)
		if err != nil {
			return fmt.Errorf("read history for export: %w", err)
		}
		for _, entry := range page.Entries {
			writeHistoryEntryMarkdown(writer, entry)
		}
		if !page.HasMore {
			break
		}
		offset = page.NextOffset
	}
	if err := writer.Flush(); err != nil {
		return fmt.Errorf("flush readable export: %w", err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync readable export: %w", err)
	}
	return nil
}

func writeHistoryEntryMarkdown(writer *bufio.Writer, entry codex.HistoryEntry) {
	if entry.Kind == codex.HistoryKindSystem && strings.TrimSpace(entry.Text) == "" {
		return
	}
	label := entry.Kind
	if entry.Role != "" {
		label += "/" + entry.Role
	}
	if entry.Name != "" {
		label += "/" + entry.Name
	}
	writer.WriteString("### " + label + "\n\n")
	if entry.Opaque {
		writer.WriteString("[opaque entry; see raw material]\n\n")
		return
	}
	if strings.TrimSpace(entry.Text) == "" {
		writer.WriteString("(empty)\n\n")
		return
	}
	writer.WriteString(entry.Text)
	writer.WriteString("\n\n")
}

// walkGenerationFiles 列出代次目录内全部文件（相对路径）。
func walkGenerationFiles(generationDir string) ([]string, error) {
	files := make([]string, 0, 8)
	err := filepath.WalkDir(generationDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(generationDir, path)
		if err != nil {
			return err
		}
		files = append(files, rel)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk generation directory: %w", err)
	}
	return files, nil
}

// SessionAssetsDeleteAsset 删除 GoNavi 资产：持久化抑制并清理副本与
// 派生材料（原工具会话不受影响）。
func (a *App) SessionAssetsDeleteAsset(assetID string) (result connection.QueryResult) {
	_, service, err := a.sessionAssetsCatalog()
	if err != nil {
		return sessionAssetsServiceError(a, err)
	}
	if err := service.DeleteAsset(context.Background(), assetID); err != nil {
		if errors.Is(err, sessionassets.ErrNotFound) {
			return connection.QueryResult{Success: false, Message: a.appText("session_assets.error.integration_not_found", nil)}
		}
		return sessionAssetsError(a, "session_assets.error.delete_failed", err)
	}
	logger.Infof("会话资产已删除：asset=%s", assetID)
	return connection.QueryResult{Success: true}
}

// SessionAssetsRefreshSources 立即对全部启用来源补核对（重检与事件
// 遗漏的手动入口）。
func (a *App) SessionAssetsRefreshSources(kind string) (result connection.QueryResult) {
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
	sources, err := catalog.ListSources(context.Background(), integration.ID)
	if err != nil {
		return sessionAssetsError(a, "session_assets.error.list_failed", err)
	}
	for _, source := range sources {
		if source.Enabled {
			a.syncAndObserveSource(service, source)
		}
	}
	return connection.QueryResult{Success: true}
}

func shortID(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

func nonEmptyText(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

// SessionAssetsSelectExportDirectory 弹出导出目标目录选择框；取消返回
// Success=false 且不计为错误。
func (a *App) SessionAssetsSelectExportDirectory() (result connection.QueryResult) {
	selection, err := openSessionAssetsDirectoryDialog(a, a.appText("session_assets.export.dialog_title", nil))
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	if strings.TrimSpace(selection) == "" {
		return connection.QueryResult{Success: false, Message: "cancelled"}
	}
	return connection.QueryResult{Success: true, Data: selection}
}

// openSessionAssetsDirectoryDialog 打开目录选择对话框（导出目标）。
// headless/web 运行时与生命周期启动前的调用没有桌面对话框能力；Wails
// 对无效上下文直接 log.Fatal（无法 recover），必须在此之前拦截。
func openSessionAssetsDirectoryDialog(a *App, title string) (selection string, err error) {
	if a == nil || a.headlessRuntime || a.webRuntime || a.ctx == nil || a.ctx == context.Background() {
		return "", errors.New("directory dialog requires the desktop runtime")
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                title,
		CanCreateDirectories: true,
	})
}
