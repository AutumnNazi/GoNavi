package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/syncjob"
)

func (executor appDataSyncJobExecutor) Execute(ctx context.Context, request syncjob.ExecutionRequest, reporter syncjob.RunReporter) (syncjob.ExecutionOutcome, error) {
	if executor.app == nil {
		return syncjob.ExecutionOutcome{}, errors.New("application is unavailable")
	}
	definition := request.Definition
	if definition.Kind == syncjob.JobKindBackup {
		return executor.app.executeBackupJob(ctx, request, reporter)
	}
	source, err := executor.app.resolveDataSyncJobEndpoint(definition.Source.ConnectionID, definition.Source.Database, definition.Source.Schema)
	if err != nil {
		return syncjob.ExecutionOutcome{}, fmt.Errorf("resolve source connection: %w", err)
	}
	target, err := executor.app.resolveDataSyncJobEndpoint(definition.Target.ConnectionID, definition.Target.Database, definition.Target.Schema)
	if err != nil {
		return syncjob.ExecutionOutcome{}, fmt.Errorf("resolve target connection: %w", err)
	}
	if err := validateDataSyncJobEndpointDrift(definition, source, target); err != nil {
		return syncjob.ExecutionOutcome{}, err
	}
	if dataSyncJobRequiresExecutionApproval(definition, target) {
		if err := executor.app.validateStoredDataSyncJobApproval(definition, target.Fingerprint); err != nil {
			return syncjob.ExecutionOutcome{}, err
		}
	}
	// 建库必须先于回滚快照：快照要连到目标库，库不存在时会直接失败。
	if err := executor.app.ensureDataSyncTargetDatabase(ctx, definition, target); err != nil {
		return syncjob.ExecutionOutcome{}, err
	}
	enabledMappings := make([]syncjob.TableMapping, 0, len(definition.Mappings))
	for _, mapping := range definition.Mappings {
		if mapping.Enabled {
			enabledMappings = append(enabledMappings, mapping)
		}
	}
	if err := executor.app.captureDataSyncRollback(ctx, request, target, enabledMappings); err != nil {
		return syncjob.ExecutionOutcome{}, err
	}
	if err := executor.prepareDataSyncTargetTables(ctx, request, definition, enabledMappings, source, target, reporter); err != nil {
		return syncjob.ExecutionOutcome{Resumable: true}, err
	}
	if definition.IncrementalMode == syncjob.IncrementalCDC {
		return executor.executeCDCJob(ctx, request, definition, enabledMappings, source, target, reporter)
	}
	if definition.IncrementalMode == syncjob.IncrementalWatermark {
		return executor.executeWatermarkJob(ctx, request, definition, enabledMappings, source, target, reporter)
	}
	startIndex, err := dataSyncJobResumeIndex(request, enabledMappings)
	if err != nil {
		return syncjob.ExecutionOutcome{}, err
	}
	definitionHash, err := dataSyncJobDefinitionHash(definition)
	if err != nil {
		return syncjob.ExecutionOutcome{}, err
	}
	outcome := syncjob.ExecutionOutcome{}
	for index := startIndex; index < len(enabledMappings); index++ {
		if err := ctx.Err(); err != nil {
			outcome.Resumable = true
			return outcome, err
		}
		mapping := enabledMappings[index]
		tableLabel := dataSyncJobMappingLabel(mapping)
		if err := reporter.ReportProgress(syncjob.RunProgress{
			Current: index,
			Total:   len(enabledMappings),
			Table:   tableLabel,
			Stage:   "running",
			Message: fmt.Sprintf("running mapping %d/%d", index+1, len(enabledMappings)),
		}); err != nil {
			return outcome, err
		}

		config, err := buildDataSyncJobEngineConfig(definition, request.Run.ID, source, target, mapping)
		if err != nil {
			outcome.Resumable = true
			return outcome, err
		}
		if definition.Kind != syncjob.JobKindCompare {
			if err := ensureDataSyncTargetProtection(config); err != nil {
				return outcome, err
			}
		}
		configureDataSyncSnapshotErrorHandling(&config, definition, mapping, reporter)
		mappingOutcome, runErr := executor.executeMappingWithRetry(ctx, request.Run.ID, definition, config, reporter)
		outcome.RowsInserted += mappingOutcome.RowsInserted
		outcome.RowsUpdated += mappingOutcome.RowsUpdated
		outcome.RowsDeleted += mappingOutcome.RowsDeleted
		outcome.RowsFailed += mappingOutcome.RowsFailed
		if runErr != nil {
			outcome.Resumable = dataSyncJobMappingRetrySafe(definition) && !db.IsWriteOutcomeUnknown(runErr)
			return outcome, runErr
		}

		cursor, _ := json.Marshal(dataSyncMappingCursor{NextMapping: index + 1})
		if err := reporter.SaveCheckpoint(syncjob.Checkpoint{
			Version:       1,
			Kind:          "resume",
			Table:         tableLabel,
			Phase:         "mapping_completed",
			CursorType:    "mapping_index",
			Cursor:        cursor,
			BatchSequence: int64(index + 1),
			SchemaHash:    definitionHash,
		}); err != nil {
			outcome.Resumable = true
			return outcome, fmt.Errorf("persist mapping checkpoint: %w", err)
		}
		if err := reporter.ReportProgress(syncjob.RunProgress{
			Current: index + 1,
			Total:   len(enabledMappings),
			Table:   tableLabel,
			Stage:   "completed",
		}); err != nil {
			return outcome, err
		}
	}
	outcome.Message = "data sync job completed"
	return outcome, nil
}
