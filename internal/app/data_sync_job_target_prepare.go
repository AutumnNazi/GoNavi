package app

import (
	"context"
	"fmt"
	"strings"

	syncbackend "GoNavi-Wails/internal/sync"
	"GoNavi-Wails/internal/syncjob"
)

// 同步任务的目标对象补建。
//
// 数据同步与一次性迁移共用同一套建表规划器：同步任务在写数据之前，先对缺失的目标表
// 跑一遍「仅结构」的引擎调用把表建出来，随后的数据阶段仍按原有的仅数据路径执行，
// 因此主键比对、行级错误隔离与显式字段映射的语义都不受影响。

// dataSyncJobCreatesTargets 报告任务能否在运行时补建目标库与目标表。
//
// CDC 的检查点语义要求目标表事先存在；查询写入与对比只碰已有对象。
func dataSyncJobCreatesTargets(definition syncjob.JobDefinition) bool {
	switch definition.Kind {
	case syncjob.JobKindMigration:
		return true
	case syncjob.JobKindReconcile:
		return definition.IncrementalMode != syncjob.IncrementalCDC
	default:
		return false
	}
}

// dataSyncJobMappingCanCreateTarget 报告缺失的目标表能否由任务自动创建。
func dataSyncJobMappingCanCreateTarget(definition syncjob.JobDefinition, mapping syncjob.TableMapping, capability syncbackend.MigrationCapability) bool {
	if !dataSyncJobCreatesTargets(definition) || !resultSupportsAutoCreate(capability) {
		return false
	}
	if definition.Kind == syncjob.JobKindReconcile {
		// 建表按源表结构原样生成，显式字段映射或过滤条件下的目标列无法从源表推出。
		if len(mapping.Columns) > 0 || strings.TrimSpace(mapping.Filter) != "" {
			return false
		}
		strategy := firstNonEmptySyncJob(mapping.TargetTableStrategy, definition.Options.TargetTableStrategy)
		return strategy != "" && strategy != "existing_only"
	}
	return !dataSyncJobMappingNeedsExplicitProjection(definition, mapping) &&
		dataSyncJobEffectiveTargetTableStrategy(definition, mapping) != "existing_only"
}

// buildDataSyncJobTargetCreateConfig 生成补建一张目标表用的仅结构引擎配置。
func buildDataSyncJobTargetCreateConfig(definition syncjob.JobDefinition, runID string, source, target resolvedDataSyncJobEndpoint, mapping syncjob.TableMapping) (syncbackend.SyncConfig, error) {
	createDefinition := definition
	createDefinition.Kind = syncjob.JobKindMigration
	createDefinition.IncrementalMode = syncjob.IncrementalSnapshot
	createDefinition.Options.Content = "schema"
	createDefinition.Options.TargetTableStrategy = "smart"
	// 新建的表按源表结构原样生成，索引是结构的一部分，一并建出。
	createDefinition.Options.CreateIndexes = true
	autoAddColumns := false
	createDefinition.Options.AutoAddColumns = &autoAddColumns

	identity := mapping
	identity.Columns = nil
	identity.KeyColumns = nil
	identity.Watermark = nil
	identity.TargetTableStrategy = "smart"
	identity.TargetTableStrategyExplicit = false
	return buildDataSyncJobEngineConfig(createDefinition, runID, source, target, identity)
}

// dataSyncTargetTableExists 检查映射的目标表是否已经存在。
func (a *App) dataSyncTargetTableExists(target resolvedDataSyncJobEndpoint, mapping syncjob.TableMapping) (bool, error) {
	result := a.DBTableExists(target.Config, target.Database, qualifyDataSyncJobObject(mapping.TargetSchema, mapping.TargetTable))
	if !result.Success {
		return false, fmt.Errorf("check target table %s: %s", dataSyncJobMappingLabel(mapping), result.Message)
	}
	payload, _ := result.Data.(map[string]bool)
	return payload["exists"], nil
}

// prepareDataSyncTargetTables 在同步任务写数据之前补建缺失的目标表。
//
// 已存在的表一律跳过：对已有表跑结构阶段会触发结构差异校验，而同步任务对已有表
// 只写数据，不应因为类型差异被拦下。续跑时表已建好，这里自然成为空操作。
func (executor appDataSyncJobExecutor) prepareDataSyncTargetTables(ctx context.Context, request syncjob.ExecutionRequest, definition syncjob.JobDefinition, mappings []syncjob.TableMapping, source, target resolvedDataSyncJobEndpoint, reporter syncjob.RunReporter) error {
	if definition.Kind != syncjob.JobKindReconcile || !dataSyncJobCreatesTargets(definition) {
		return nil
	}
	capability := syncbackend.ResolveMigrationCapability(source.Config, target.Config)
	for _, mapping := range mappings {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !dataSyncJobMappingCanCreateTarget(definition, mapping, capability) {
			continue
		}
		exists, err := executor.app.dataSyncTargetTableExists(target, mapping)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		config, err := buildDataSyncJobTargetCreateConfig(definition, request.Run.ID, source, target, mapping)
		if err != nil {
			return err
		}
		if err := ensureDataSyncTargetProtection(config); err != nil {
			return err
		}
		if _, err := executor.executeOneMapping(ctx, request.Run.ID, definition.Kind, config, reporter); err != nil {
			return fmt.Errorf("create target table %s: %w", dataSyncJobMappingLabel(mapping), err)
		}
	}
	return nil
}
