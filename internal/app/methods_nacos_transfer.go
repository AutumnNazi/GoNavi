package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/nacos"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type nacosImportPreviewItem struct {
	DataID   string `json:"dataId"`
	Group    string `json:"group"`
	Type     string `json:"type,omitempty"`
	Exists   bool   `json:"exists"`
	Selected bool   `json:"selected"`
}

type nacosImportPreview struct {
	File          string                   `json:"file"`
	ExportedAt    string                   `json:"exportedAt,omitempty"`
	NamespaceID   string                   `json:"namespaceId,omitempty"`
	SourceAppName string                   `json:"sourceAppName,omitempty"`
	Total         int                      `json:"total"`
	ExistsCount   int                      `json:"existsCount"`
	NewCount      int                      `json:"newCount"`
	Items         []nacosImportPreviewItem `json:"items"`
}

// NacosExportConfigs exports configs from a namespace to a JSON file.
func (a *App) NacosExportConfigs(config connection.ConnectionConfig, options NacosExportConfigsOptions) connection.QueryResult {
	config.Type = "nacos"
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}

	scope := strings.ToLower(strings.TrimSpace(options.Scope))
	if scope == "" {
		scope = "all"
	}
	namespaceID := strings.TrimSpace(options.NamespaceID)
	namespaceName := strings.TrimSpace(options.NamespaceName)
	if namespaceName == "" {
		if namespaceID == "" {
			namespaceName = "public"
		} else {
			namespaceName = namespaceID
		}
	}

	defaultName := fmt.Sprintf("nacos-%s-configs.json", sanitizeNacosFilename(namespaceName))
	if scope == "selected" {
		defaultName = fmt.Sprintf("nacos-%s-selected-configs.json", sanitizeNacosFilename(namespaceName))
	}
	filename, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           a.appText("file.backend.dialog.export_data", nil),
		DefaultFilename: defaultName,
		Filters: []runtime.FileFilter{
			{
				DisplayName: a.appText("file.backend.filter.json_files", nil),
				Pattern:     "*.json",
			},
		},
	})
	if err != nil || strings.TrimSpace(filename) == "" {
		return connection.QueryResult{Success: false, Message: "已取消"}
	}
	filename = normalizeNacosTransferFilename(filename)

	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()

	entries, err := collectNacosExportEntries(ctx, client, namespaceID, scope, options)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	if len(entries) == 0 {
		return connection.QueryResult{Success: false, Message: a.appText("nacos.backend.error.export_empty", nil)}
	}

	payload := nacos.NewTransferFile(namespaceID, namespaceName)
	payload.Configs = entries
	if err := nacos.WriteTransferFile(filename, payload); err != nil {
		return connection.QueryResult{Success: false, Message: a.appText("file.backend.error.write_failed", map[string]any{"detail": err.Error()})}
	}
	logger.Infof("Nacos 配置导出成功：ns=%s count=%d file=%s", namespaceName, len(entries), filename)
	return connection.QueryResult{
		Success: true,
		Message: a.appText("nacos.backend.message.export_success", nil),
		Data: map[string]any{
			"exported": len(entries),
			"file":     filename,
		},
	}
}

// NacosPreviewImportConfigs opens a file and previews import conflicts.
func (a *App) NacosPreviewImportConfigs(config connection.ConnectionConfig, namespaceID string) connection.QueryResult {
	config.Type = "nacos"
	selection, err := a.openNacosImportTransferFileDialog()
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	if strings.TrimSpace(selection) == "" {
		return connection.QueryResult{Success: false, Message: "已取消"}
	}

	payload, err := nacos.ReadTransferFile(selection)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) || errors.Is(err, os.ErrPermission) {
			return connection.QueryResult{Success: false, Message: a.appText("file.backend.error.open_file_failed", map[string]any{"detail": err.Error()})}
		}
		var syntaxErr *json.SyntaxError
		if errors.As(err, &syntaxErr) {
			return connection.QueryResult{Success: false, Message: a.appText("file.backend.error.import_json_parse_failed", map[string]any{"detail": err.Error()})}
		}
		return connection.QueryResult{Success: false, Message: err.Error()}
	}

	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()

	preview := buildNacosImportPreview(ctx, client, selection, namespaceID, payload)
	return connection.QueryResult{Success: true, Data: preview}
}

// NacosImportConfigs imports configs from a transfer file.
func (a *App) NacosImportConfigs(config connection.ConnectionConfig, options NacosImportConfigsOptions) connection.QueryResult {
	config.Type = "nacos"
	if err := a.ensureNacosDataEditAllowed(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}

	selection := strings.TrimSpace(options.File)
	var err error
	if selection == "" {
		selection, err = a.openNacosImportTransferFileDialog()
		if err != nil {
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
	}
	if strings.TrimSpace(selection) == "" {
		return connection.QueryResult{Success: false, Message: "已取消"}
	}

	payload, err := nacos.ReadTransferFile(selection)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}

	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()

	conflictMode := strings.ToLower(strings.TrimSpace(options.ConflictMode))
	if conflictMode != "overwrite" {
		conflictMode = "skip"
	}
	selected := make(map[string]struct{}, len(options.Items))
	for _, item := range options.Items {
		key := nacosConfigKey(item.Group, item.DataID)
		if key != "" {
			selected[key] = struct{}{}
		}
	}
	useSelected := strings.ToLower(strings.TrimSpace(options.Scope)) == "selected" && len(selected) > 0

	imported := 0
	skipped := 0
	failed := 0
	var firstErr error
	namespaceID := strings.TrimSpace(options.NamespaceID)

	for _, item := range payload.Configs {
		key := nacosConfigKey(item.Group, item.DataID)
		if useSelected {
			if _, ok := selected[key]; !ok {
				continue
			}
		}
		exists, existsErr := nacosConfigExists(ctx, client, namespaceID, item.Group, item.DataID)
		if existsErr != nil {
			failed++
			if firstErr == nil {
				firstErr = existsErr
			}
			continue
		}
		if exists && conflictMode == "skip" {
			skipped++
			continue
		}
		if err := client.PublishConfig(ctx, nacos.PublishRequest{
			NamespaceID: namespaceID,
			DataID:      item.DataID,
			Group:       item.Group,
			Content:     item.Content,
			Type:        item.Type,
			AppName:     item.AppName,
			Desc:        item.Desc,
		}); err != nil {
			failed++
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		imported++
	}

	if imported == 0 && failed > 0 && firstErr != nil {
		return connection.QueryResult{Success: false, Message: firstErr.Error()}
	}
	logger.Infof("Nacos 配置导入完成：imported=%d skipped=%d failed=%d file=%s", imported, skipped, failed, selection)
	return connection.QueryResult{
		Success: true,
		Message: a.appText("nacos.backend.message.import_success", nil),
		Data: map[string]any{
			"imported": imported,
			"skipped":  skipped,
			"failed":   failed,
			"file":     selection,
		},
	}
}

func (a *App) openNacosImportTransferFileDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: a.appText("file.backend.dialog.import_data", map[string]any{"table": "nacos"}),
		Filters: []runtime.FileFilter{
			{
				DisplayName: a.appText("file.backend.filter.json_files", nil),
				Pattern:     "*.json",
			},
			{
				DisplayName: a.appText("file.backend.filter.all_files", nil),
				Pattern:     "*",
			},
		},
	})
}

func collectNacosExportEntries(
	ctx context.Context,
	client nacos.Client,
	namespaceID, scope string,
	options NacosExportConfigsOptions,
) ([]nacos.TransferConfigEntry, error) {
	if scope == "selected" {
		entries := make([]nacos.TransferConfigEntry, 0, len(options.Items))
		for _, item := range options.Items {
			dataID := strings.TrimSpace(item.DataID)
			group := strings.TrimSpace(item.Group)
			if dataID == "" {
				continue
			}
			if group == "" {
				group = "DEFAULT_GROUP"
			}
			detail, err := client.GetConfig(ctx, namespaceID, group, dataID)
			if err != nil {
				return nil, err
			}
			entries = append(entries, nacos.TransferConfigEntry{
				DataID:  detail.DataID,
				Group:   detail.Group,
				Content: detail.Content,
				Type:    detail.Type,
				AppName: detail.AppName,
				Desc:    detail.Desc,
			})
		}
		return entries, nil
	}

	// Export all: page through search API then fetch each content.
	const pageSize = 100
	pageNo := 1
	entries := make([]nacos.TransferConfigEntry, 0, 64)
	seen := make(map[string]struct{})
	for {
		page, err := client.SearchConfigs(ctx, nacos.ConfigQuery{
			NamespaceID: namespaceID,
			PageNo:      pageNo,
			PageSize:    pageSize,
			Search:      "blur",
		})
		if err != nil {
			return nil, err
		}
		if page == nil || len(page.PageItems) == 0 {
			break
		}
		for _, item := range page.PageItems {
			key := nacosConfigKey(item.Group, item.DataID)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			// Prefer content from list if present; otherwise fetch.
			content := item.Content
			typ := item.Type
			appName := item.AppName
			desc := item.Desc
			if strings.TrimSpace(content) == "" {
				detail, getErr := client.GetConfig(ctx, namespaceID, item.Group, item.DataID)
				if getErr != nil {
					return nil, getErr
				}
				content = detail.Content
				if typ == "" {
					typ = detail.Type
				}
				if appName == "" {
					appName = detail.AppName
				}
				if desc == "" {
					desc = detail.Desc
				}
			}
			entries = append(entries, nacos.TransferConfigEntry{
				DataID:  item.DataID,
				Group:   item.Group,
				Content: content,
				Type:    typ,
				AppName: appName,
				Desc:    desc,
			})
		}
		if pageNo >= page.PagesAvailable || len(page.PageItems) < pageSize {
			break
		}
		pageNo++
		// safety cap
		if pageNo > 200 {
			break
		}
	}
	return entries, nil
}

func buildNacosImportPreview(
	ctx context.Context,
	client nacos.Client,
	file, namespaceID string,
	payload nacos.TransferFile,
) nacosImportPreview {
	items := make([]nacosImportPreviewItem, 0, len(payload.Configs))
	existsCount := 0
	for _, cfg := range payload.Configs {
		exists, _ := nacosConfigExists(ctx, client, namespaceID, cfg.Group, cfg.DataID)
		if exists {
			existsCount++
		}
		items = append(items, nacosImportPreviewItem{
			DataID:   cfg.DataID,
			Group:    cfg.Group,
			Type:     cfg.Type,
			Exists:   exists,
			Selected: true,
		})
	}
	return nacosImportPreview{
		File:          file,
		ExportedAt:    payload.ExportedAt,
		NamespaceID:   payload.NamespaceID,
		SourceAppName: payload.SourceAppName,
		Total:         len(items),
		ExistsCount:   existsCount,
		NewCount:      len(items) - existsCount,
		Items:         items,
	}
}

func nacosConfigExists(ctx context.Context, client nacos.Client, namespaceID, group, dataID string) (bool, error) {
	// Use short timeout so preview remains responsive.
	probeCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	_, err := client.GetConfig(probeCtx, namespaceID, group, dataID)
	if err == nil {
		return true, nil
	}
	// Treat not-found style errors as missing.
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "not found") || strings.Contains(msg, "不存在") {
		return false, nil
	}
	// Some servers return 404 wrapped as http_status.
	if strings.Contains(msg, "404") {
		return false, nil
	}
	return false, err
}

func nacosConfigKey(group, dataID string) string {
	dataID = strings.TrimSpace(dataID)
	if dataID == "" {
		return ""
	}
	group = strings.TrimSpace(group)
	if group == "" {
		group = "DEFAULT_GROUP"
	}
	return group + "@@" + dataID
}

func normalizeNacosTransferFilename(filename string) string {
	trimmed := strings.TrimSpace(filename)
	if trimmed == "" {
		return ""
	}
	if strings.EqualFold(filepath.Ext(trimmed), ".json") {
		return trimmed
	}
	return trimmed + ".json"
}

func sanitizeNacosFilename(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return "namespace"
	}
	replacer := strings.NewReplacer("/", "-", "\\", "-", ":", "-", " ", "_")
	return replacer.Replace(text)
}
