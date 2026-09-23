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
	syncbackend "GoNavi-Wails/internal/sync"
	"GoNavi-Wails/internal/syncjob"
)

func (a *App) preflightBackupJob(ctx context.Context, definition syncjob.JobDefinition, now time.Time) DataSyncJobPreflightResult {
	definition.Approval = nil
	result := DataSyncJobPreflightResult{Definition: definition, CheckedAt: now.UnixMilli(), Issues: []DataSyncJobPreflightIssue{}, NextRunAt: []int64{}}
	fail := func(code, stage string, err error) DataSyncJobPreflightResult {
		result.Issues = append(result.Issues, preflightIssue(code, DataSyncJobPreflightBlocker, stage, err.Error(), ""))
		return finishDataSyncJobPreflight(result)
	}
	if err := ctx.Err(); err != nil {
		return fail("request_cancelled", "preflight", err)
	}
	if err := syncjob.ValidateDefinition(definition); err != nil {
		return fail("definition_invalid", "endpoints", err)
	}
	// Web RPC is scoped to managed downloads. An unattended arbitrary local path
	// must not turn that boundary into a remote filesystem write primitive.
	if a.webRuntime {
		return fail("definition_invalid", "delivery", errors.New(a.appText("data_sync.backup.desktop_only", nil)))
	}
	source, err := a.resolveDataSyncJobEndpoint(definition.Source.ConnectionID, definition.Source.Database, definition.Source.Schema)
	if err != nil {
		return fail("source_connection_failed", "endpoints", err)
	}
	if !backupSQLSupported(source.Config.Type) {
		return fail("definition_invalid", "endpoints", errors.New(a.appText("data_sync.backup.unsupported", nil)))
	}
	definition.Source.ConnectionName = source.View.Name
	definition.Source.ConnectionType = source.Config.Type
	definition.Source.Fingerprint = source.Fingerprint
	result.Definition = definition
	result.SourceFingerprint = source.Fingerprint
	result.Capability = syncbackend.MigrationCapability{SourceType: source.Config.Type, TargetType: "sql", SupportLevel: syncbackend.MigrationSupportLevelFull, CanExecute: true}
	for _, mapping := range definition.Mappings {
		if !mapping.Enabled {
			continue
		}
		table := qualifyDataSyncJobObject(mapping.SourceSchema, mapping.SourceTable)
		checked := a.runWebMetadataWithContext(ctx, func(session *App) connection.QueryResult {
			return session.DBGetColumns(source.Config, source.Database, table)
		})
		if !checked.Success {
			return fail("source_columns_failed", "mappings", errors.New(checked.Message))
		}
	}
	if err := a.checkBackupDirectory(definition.Backup.Directory); err != nil {
		return fail("definition_invalid", "delivery", err)
	}
	result.DefinitionHash, err = dataSyncJobDefinitionHash(definition)
	if err != nil {
		return fail("definition_hash_failed", "preflight", err)
	}
	result.NextRunAt = previewDataSyncJobSchedule(definition, now, 5)
	return finishDataSyncJobPreflight(result)
}

func backupSQLSupported(kind string) bool {
	switch normalizeSQLClassifierDBType(kind) {
	case "mysql", "mariadb", "oceanbase", "postgres", "kingbase", "highgo", "vastbase", "opengauss", "gaussdb", "sqlite", "duckdb", "sqlserver", "oracle", "dameng", "clickhouse", "iris":
		return true
	default:
		return false
	}
}

// Preflight checks an existing directory without creating a backup. Each run
// exclusively creates its own subdirectory; completed backups never overwrite.
func (a *App) checkBackupDirectory(directory string) error {
	directory = strings.TrimSpace(directory)
	info, err := os.Stat(directory)
	if err != nil {
		return fmt.Errorf("inspect backup directory: %w", err)
	}
	if !info.IsDir() {
		return errors.New(a.appText("data_sync.backup.directory_invalid", nil))
	}
	probe, err := os.CreateTemp(directory, ".gonavi-backup-probe-*")
	if err != nil {
		return fmt.Errorf("check backup directory access: %w", err)
	}
	closeErr := probe.Close()
	removeErr := os.Remove(probe.Name())
	return errors.Join(closeErr, removeErr)
}

func (a *App) executeBackupJob(ctx context.Context, request syncjob.ExecutionRequest, reporter syncjob.RunReporter) (syncjob.ExecutionOutcome, error) {
	outcome := syncjob.ExecutionOutcome{}
	if a.webRuntime {
		return outcome, errors.New(a.appText("data_sync.backup.desktop_only", nil))
	}
	definition := request.Definition
	if err := syncjob.ValidateDefinition(definition); err != nil {
		return outcome, err
	}
	source, err := a.resolveDataSyncJobEndpoint(definition.Source.ConnectionID, definition.Source.Database, definition.Source.Schema)
	if err != nil {
		return outcome, fmt.Errorf("resolve backup source: %w", err)
	}
	if !backupSQLSupported(source.Config.Type) {
		return outcome, errors.New(a.appText("data_sync.backup.unsupported", nil))
	}
	if definition.Source.Fingerprint == "" || !secureTextEqual(definition.Source.Fingerprint, source.Fingerprint) {
		return outcome, errors.New(a.appText("data_sync.backup.source_changed", nil))
	}
	if err := ctx.Err(); err != nil {
		return outcome, err
	}
	directory, err := os.MkdirTemp(strings.TrimSpace(definition.Backup.Directory), "gonavi-"+time.Now().UTC().Format("20060102T150405Z")+"-*")
	if err != nil {
		return outcome, fmt.Errorf("create backup run directory: %w", err)
	}
	path := filepath.Join(directory, "backup.sql")
	// A failed/cancelled export has no completed file. Remove only the directory
	// exclusively created by this call; never recurse into the user's directory.
	defer func() {
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			if err := os.Remove(directory); err != nil {
				logger.Warnf("清理未完成备份目录失败：%v", err)
			}
		}
	}()
	tables := make([]string, 0, len(definition.Mappings))
	for _, mapping := range definition.Mappings {
		if mapping.Enabled {
			tables = append(tables, qualifyDataSyncJobObject(mapping.SourceSchema, mapping.SourceTable))
		}
	}
	if err := reporter.ReportProgress(syncjob.RunProgress{Total: len(tables), Stage: "running"}); err != nil {
		return outcome, err
	}
	content := definition.Backup.Content
	result := a.runWebMetadataWithContext(ctx, func(session *App) connection.QueryResult {
		return session.exportTablesSQLToFile(ctx, source.Config, backupExportNamespace(source), tables, content != "data", content != "schema", path, nil, ExportFileOptions{Format: "sql"}, nil)
	})
	if !result.Success {
		if err := ctx.Err(); err != nil {
			return outcome, err
		}
		return outcome, fmt.Errorf("export backup: %s", result.Message)
	}
	payload, err := json.Marshal(map[string]any{"filePath": path, "objectCount": len(tables)})
	if err != nil {
		return outcome, fmt.Errorf("encode backup result: %w", err)
	}
	if err := reporter.Emit(syncjob.RunEventLog, a.appText("data_sync.backup.completed", map[string]any{"path": path}), payload); err != nil {
		return outcome, err
	}
	return outcome, reporter.ReportProgress(syncjob.RunProgress{Current: len(tables), Total: len(tables), Stage: "completed", Message: path})
}

func backupExportNamespace(source resolvedDataSyncJobEndpoint) string {
	if normalizeSQLClassifierDBType(source.Config.Type) == "sqlite" {
		if strings.TrimSpace(source.Schema) != "" {
			return source.Schema
		}
		return "main"
	}
	return source.Database
}
