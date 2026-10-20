package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/syncjob"
	"GoNavi-Wails/internal/taskrollback"
)

var resolveTaskRollbackConnectionFn = func(a *App, point taskrollback.Point) (connection.ConnectionConfig, error) {
	return a.resolveTaskRollbackConnection(point)
}

func (a *App) resolveTaskRollbackConnection(point taskrollback.Point) (connection.ConnectionConfig, error) {
	connectionID := strings.TrimSpace(point.ConnectionID)
	if connectionID == "" {
		return connection.ConnectionConfig{}, errors.New(a.appText("task_rollback.error.connection_missing", nil))
	}
	resolved, err := a.resolveDataSyncSavedEndpoint(connectionID, point.Database, point.Schema)
	if err != nil {
		return connection.ConnectionConfig{}, errors.New(a.appText("task_rollback.error.connection_missing", nil))
	}
	config := resolved.Config
	if strings.TrimSpace(config.Type) == "" {
		config.Type = point.DBType
	}
	if strings.TrimSpace(config.ID) == "" {
		config.ID = connectionID
	}
	return config, nil
}

func (a *App) restoreTaskRollbackPoint(ctx context.Context, point taskrollback.Point) error {
	if ctx == nil {
		ctx = context.Background()
	}
	store, err := a.taskRollbackStore()
	if err != nil {
		return err
	}
	locked, err := store.TryStartRestore(point.ID)
	if err != nil {
		return a.taskRollbackRestoreError(err)
	}
	restored := false
	defer func() {
		_ = store.FinishRestore(locked.ID, restored)
	}()
	config, err := resolveTaskRollbackConnectionFn(a, locked)
	if err != nil {
		return err
	}
	// 回放快照和删除新建对象都会改结构和数据，沿用导入的只读与脚本保护。
	if err := a.validateDatabaseSQLImportAccess(config); err != nil {
		return err
	}
	runConfig := normalizeRunConfig(config, locked.Database)
	dbInst, err := a.getDatabaseWithContext(ctx, runConfig, false)
	if err != nil {
		return a.taskRollbackRestoreError(err)
	}
	current, err := listTaskRollbackCatalog(dbInst, runConfig, locked.Database)
	if err != nil {
		return a.taskRollbackRestoreError(err)
	}
	if err := a.dropRollbackObjects(ctx, dbInst, runConfig, locked, current); err != nil {
		return a.taskRollbackRestoreError(err)
	}
	snapshotPath, err := store.SnapshotPath(locked.ID)
	if err != nil {
		return a.taskRollbackRestoreError(err)
	}
	replay, err := taskRollbackSnapshotNeedsReplay(snapshotPath)
	if err != nil {
		return a.taskRollbackRestoreError(err)
	}
	if replay {
		if err := a.replayTaskRollbackSnapshot(ctx, dbInst, config, locked, snapshotPath); err != nil {
			return a.taskRollbackRestoreError(err)
		}
	}
	restored = true
	return nil
}

func (a *App) dropRollbackObjects(ctx context.Context, dbInst db.Database, config connection.ConnectionConfig, point taskrollback.Point, current []taskrollback.Object) error {
	drops := rollbackObjectsToDrop(config, point.Database, point, current)
	if len(drops) == 0 {
		return nil
	}
	disable, enable, guard := taskRollbackForeignKeyGuard(resolveDDLDBType(config))
	if guard {
		if _, err := execSQLFileStatement(ctx, dbInst, disable); err != nil {
			return err
		}
		defer func() { _, _ = execSQLFileStatement(context.Background(), dbInst, enable) }()
	}
	for _, object := range drops {
		statement := buildSQLDropIfExistsStatement(config, point.Database, object.Name, object.IsView)
		if strings.TrimSpace(statement) == "" {
			return fmt.Errorf("cannot drop %s", object.Name)
		}
		if _, err := execSQLFileStatement(ctx, dbInst, strings.TrimSuffix(strings.TrimSpace(statement), ";")); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) replayTaskRollbackSnapshot(ctx context.Context, dbInst db.Database, config connection.ConnectionConfig, point taskrollback.Point, snapshotPath string) error {
	result := a.executeSQLFileWithStatementLimitPolicyContextWithPolicy(
		ctx,
		config,
		point.Database,
		snapshotPath,
		taskRollbackReplayJobID(point.ID),
		false,
		DefaultSQLImportMaxStatementBytes,
		runtimeSupportsSessionExecer(dbInst),
		"sql_file",
		sqlFileExecutionPolicy{
			TransactionMode:      sqlFileTransactionModeOff,
			PinDatabase:          point.Database,
			SkipRollbackSnapshot: true,
		},
	)
	if result.Success {
		return nil
	}
	if strings.TrimSpace(result.Message) == "" {
		return errors.New("rollback snapshot replay failed")
	}
	return errors.New(result.Message)
}

func taskRollbackReplayJobID(pointID string) string {
	jobID := "rb" + strings.ReplaceAll(strings.TrimSpace(pointID), "-", "")
	if len(jobID) > 128 {
		return jobID[:128]
	}
	return jobID
}

func (a *App) taskRollbackRestoreError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, taskrollback.ErrNotFound):
		return errors.New(a.appText("task_rollback.error.not_found", nil))
	case errors.Is(err, taskrollback.ErrNotReady):
		return errors.New(a.appText("task_rollback.error.not_ready", nil))
	case errors.Is(err, taskrollback.ErrBusy):
		return errors.New(a.appText("task_rollback.error.busy", nil))
	default:
		return fmt.Errorf("%s", a.appText("task_rollback.error.restore_failed", map[string]any{"detail": err.Error()}))
	}
}

func (a *App) findReadyRollbackPoint(taskIDs ...string) (taskrollback.Point, error) {
	store, err := a.taskRollbackStore()
	if err != nil {
		return taskrollback.Point{}, err
	}
	var last error = taskrollback.ErrNotFound
	for _, taskID := range taskIDs {
		point, err := store.ReadyByTask(taskID)
		if err == nil {
			return point, nil
		}
		last = err
	}
	return taskrollback.Point{}, last
}

func (a *App) syncRollbackTaskChain(ctx context.Context, run syncjob.RunRecord) []string {
	chain := make([]string, 0, 4)
	seen := map[string]struct{}{}
	manager, err := a.ensureDataSyncJobManager()
	current := run
	for i := 0; i < 8; i++ {
		id := strings.TrimSpace(current.ID)
		if id == "" {
			break
		}
		if _, ok := seen[id]; ok {
			break
		}
		seen[id] = struct{}{}
		chain = append(chain, id)
		parentID := strings.TrimSpace(current.ParentRunID)
		if parentID == "" || err != nil || manager == nil {
			break
		}
		parent, getErr := manager.GetRun(ctx, parentID)
		if getErr != nil {
			chain = append(chain, parentID)
			break
		}
		current = parent
	}
	return chain
}
