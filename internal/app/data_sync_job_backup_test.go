//go:build gonavi_full_drivers || gonavi_sqlite_driver

package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/syncjob"
)

type backupReporter struct{ path string }

func (*backupReporter) ReportProgress(syncjob.RunProgress) error { return nil }
func (*backupReporter) SaveCheckpoint(syncjob.Checkpoint) error  { return nil }
func (*backupReporter) AppendErrorRow(syncjob.ErrorRow) error    { return nil }
func (reporter *backupReporter) Emit(_ syncjob.RunEventType, _ string, payload json.RawMessage) error {
	var event struct {
		Path string `json:"filePath"`
	}
	if err := json.Unmarshal(payload, &event); err != nil {
		return err
	}
	reporter.path = event.Path
	return nil
}

func setupBackupTest(t *testing.T) (*App, syncjob.JobDefinition) {
	t.Helper()
	previousFactory := newDatabaseFunc
	newDatabaseFunc = func(kind string) (db.Database, error) {
		if kind == "sqlite" {
			return &db.SQLiteDB{}, nil
		}
		return previousFactory(kind)
	}
	t.Cleanup(func() { newDatabaseFunc = previousFactory })
	application := NewAppWithSecretStore(newFakeAppSecretStore())
	application.configDir = t.TempDir()
	t.Cleanup(application.Shutdown)
	file := filepath.Join(t.TempDir(), "source.db")
	database, err := sql.Open("sqlite", file)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, note TEXT); INSERT INTO orders VALUES (1, '你好 O''Brien'), (2, NULL)"); err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := application.SaveConnection(connection.SavedConnectionInput{ID: "backup-source", Name: "source", Config: connection.ConnectionConfig{ID: "backup-source", Type: "sqlite", Database: file}}); err != nil {
		t.Fatal(err)
	}
	definition := syncjob.NormalizeDefinition(syncjob.JobDefinition{Name: "backup", Kind: syncjob.JobKindBackup, Lifecycle: syncjob.JobLifecycleReady,
		Source: syncjob.EndpointRef{ConnectionID: "backup-source", Database: file}, Backup: &syncjob.BackupSpec{Directory: t.TempDir(), Content: "both"},
		Mappings: []syncjob.TableMapping{{SourceTable: "orders", Enabled: true}}})
	return application, definition
}

func TestBackupSQLRoundTripAndRepeatedRuns(t *testing.T) {
	application, definition := setupBackupTest(t)
	checked := application.preflightBackupJob(context.Background(), definition, time.Now())
	if !checked.Success {
		t.Fatalf("preflight: %+v", checked.Issues)
	}
	if checked.ApprovalRequired || checked.TargetFingerprint != "" {
		t.Fatal("backup must not request target write approval")
	}
	firstPath := ""
	for index := 0; index < 2; index++ {
		reporter := &backupReporter{}
		_, err := application.executeBackupJob(context.Background(), syncjob.ExecutionRequest{Definition: checked.Definition}, reporter)
		if err != nil {
			t.Fatal(err)
		}
		if reporter.path == "" || reporter.path == firstPath {
			t.Fatalf("backup path not independent: %q", reporter.path)
		}
		firstPath = reporter.path
		content, err := os.ReadFile(reporter.path)
		if err != nil {
			t.Fatal(err)
		}
		restored, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "restored.db"))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := restored.Exec(string(content)); err != nil {
			restored.Close()
			t.Fatalf("restore SQL: %v", err)
		}
		var note string
		if err := restored.QueryRow("SELECT note FROM orders WHERE id=1").Scan(&note); err != nil {
			t.Fatal(err)
		}
		if note != "你好 O'Brien" {
			t.Fatalf("restored note: %q", note)
		}
		var count int
		if err := restored.QueryRow("SELECT COUNT(*) FROM orders").Scan(&count); err != nil || count != 2 {
			t.Fatalf("restored rows %d err=%v", count, err)
		}
		if err := restored.Close(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestBackupFailureCancellationAndDriftLeaveNoCompletedFile(t *testing.T) {
	for _, scenario := range []string{"missing table", "canceled", "drift"} {
		t.Run(scenario, func(t *testing.T) {
			application, definition := setupBackupTest(t)
			checked := application.preflightBackupJob(context.Background(), definition, time.Now())
			if !checked.Success {
				t.Fatalf("preflight: %+v", checked.Issues)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch scenario {
			case "missing table":
				checked.Definition.Mappings[0].SourceTable = "missing_table"
			case "canceled":
				cancel()
			case "drift":
				checked.Definition.Source.Fingerprint = "changed"
			}
			_, err := application.executeBackupJob(ctx, syncjob.ExecutionRequest{Definition: checked.Definition}, &backupReporter{})
			if err == nil {
				t.Fatal("expected failure")
			}
			if scenario == "canceled" && !errors.Is(err, context.Canceled) {
				t.Fatalf("lost cancellation: %v", err)
			}
			entries, err := os.ReadDir(definition.Backup.Directory)
			if err != nil || len(entries) != 0 {
				t.Fatalf("failed backup retained entries %v: %v", entries, err)
			}
		})
	}
}

// 失败备份收回自己的日期目录时，必须止步于「非空即停」。
// 同一天先有成功备份、后有一次失败备份时，清理失败的那次不能连带删掉
// 当天的成功产物与日期目录 —— 那会把用户的恢复依据变成孤儿文件。
func TestBackupFailureKeepsSameDaySuccessfulBackup(t *testing.T) {
	application, definition := setupBackupTest(t)
	checked := application.preflightBackupJob(context.Background(), definition, time.Now())
	if !checked.Success {
		t.Fatalf("preflight: %+v", checked.Issues)
	}
	successReporter := &backupReporter{}
	if _, err := application.executeBackupJob(context.Background(), syncjob.ExecutionRequest{Definition: checked.Definition}, successReporter); err != nil {
		t.Fatal(err)
	}

	failed := checked.Definition
	failed.Mappings = append([]syncjob.TableMapping(nil), checked.Definition.Mappings...)
	failed.Mappings[0].SourceTable = "missing_table"
	if _, err := application.executeBackupJob(context.Background(), syncjob.ExecutionRequest{Definition: failed}, &backupReporter{}); err == nil {
		t.Fatal("expected failure")
	}

	if _, err := os.Stat(successReporter.path); err != nil {
		t.Fatalf("failed run's cleanup removed the successful backup: %v", err)
	}
	if _, err := os.Stat(filepath.Dir(successReporter.path)); err != nil {
		t.Fatalf("failed run's cleanup removed the day directory: %v", err)
	}
}

func TestBackupSaveAndRunThroughPublicAPI(t *testing.T) {
	application, definition := setupBackupTest(t)
	saved := application.DataSyncJobSave(definition, "")
	if !saved.Success {
		t.Fatal(saved.Message)
	}
	job := saved.Data.(syncjob.JobDefinition)
	queued := application.DataSyncRunStart(job.ID, job.Revision, "")
	if !queued.Success {
		t.Fatal(queued.Message)
	}
	run := queued.Data.(syncjob.RunRecord)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		result := application.DataSyncRunGet(run.ID)
		if !result.Success {
			t.Fatal(result.Message)
		}
		current := result.Data.(syncjob.RunRecord)
		if current.Status == syncjob.RunStatusSucceeded {
			return
		}
		if current.Status == syncjob.RunStatusFailed {
			t.Fatalf("backup run: %+v", current)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("backup run did not complete")
}

func TestBackupWebPreflightCannotWriteArbitraryPath(t *testing.T) {
	application, definition := setupBackupTest(t)
	application.webRuntime = true
	result := application.preflightBackupJob(context.Background(), definition, time.Now())
	if result.Success || len(result.Issues) == 0 || result.Issues[0].Message != application.appText("data_sync.backup.desktop_only", nil) {
		t.Fatalf("web preflight: %+v", result)
	}
}

func TestBackupWebExecutionRejectsExistingDesktopTask(t *testing.T) {
	application, definition := setupBackupTest(t)
	checked := application.preflightBackupJob(context.Background(), definition, time.Now())
	if !checked.Success {
		t.Fatalf("preflight: %+v", checked.Issues)
	}
	application.webRuntime = true
	_, err := application.executeBackupJob(context.Background(), syncjob.ExecutionRequest{Definition: checked.Definition}, &backupReporter{})
	if err == nil || err.Error() != application.appText("data_sync.backup.desktop_only", nil) {
		t.Fatalf("web execution: %v", err)
	}
	entries, err := os.ReadDir(definition.Backup.Directory)
	if err != nil || len(entries) != 0 {
		t.Fatalf("web execution wrote backup files: %v, %v", entries, err)
	}
}
