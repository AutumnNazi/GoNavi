package sync

import (
	"context"
	"errors"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

// characterLengthTarget records observed syntax support, not a version guess.
// It belongs to one plan and must not be cached across connections or databases.
type characterLengthTarget struct {
	qualified   bool
	probeFailed bool
}

func buildSchemaMigrationPlan(config SyncConfig, tableName string, sourceDB db.Database, targetDB db.Database) (SchemaMigrationPlan, []connection.ColumnDefinition, []connection.ColumnDefinition, error) {
	targetType := resolveMigrationDBType(config.TargetConfig)
	if config.characterLengthTarget == nil && resolveMigrationDBType(config.SourceConfig) == "oracle" && targetCountsCharLengthInBytes(targetType) {
		supported, err := db.ProbeCharacterLengthSemantics(targetDB)
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return SchemaMigrationPlan{}, nil, nil, err
		}
		config.characterLengthTarget = &characterLengthTarget{qualified: supported, probeFailed: err != nil}
	}
	plan, sourceCols, targetCols, err := buildSchemaMigrationPlanBase(config, tableName, sourceDB, targetDB)
	plan.characterLengthTarget = config.characterLengthTarget
	if err != nil {
		return plan, sourceCols, targetCols, err
	}
	if config.characterLengthTarget != nil && config.characterLengthTarget.probeFailed {
		plan.Warnings = append(plan.Warnings, localizedSyncBackendText("data_sync.backend.hint.character_length_probe_failed", map[string]any{"target": targetType}))
	}
	plan = withExistingCharacterLengthWarnings(config, tableName, plan, sourceCols, targetCols)
	return dedupeSchemaMigrationPlan(plan), sourceCols, targetCols, nil
}

// Existing columns are never changed here. The warning compares a conservative
// UTF-8 capacity bound, not actual row values, and does not claim certain failure.
func withExistingCharacterLengthWarnings(config SyncConfig, tableName string, plan SchemaMigrationPlan, sourceCols, targetCols []connection.ColumnDefinition) SchemaMigrationPlan {
	if !plan.TargetTableExists || resolveMigrationDBType(config.SourceConfig) != "oracle" || !targetCountsCharLengthInBytes(resolveMigrationDBType(config.TargetConfig)) {
		return plan
	}
	targets := make(map[string]connection.ColumnDefinition, len(targetCols))
	for _, col := range targetCols {
		targets[strings.ToLower(strings.TrimSpace(col.Name))] = col
	}
	names := existingCharacterColumnNames(config, tableName, sourceCols)
	found := false
	for _, source := range sourceCols {
		targetName, included := names[source.Name]
		if !included {
			continue
		}
		target, exists := targets[strings.ToLower(strings.TrimSpace(targetName))]
		if !exists || !characterLengthMayNarrow(source.Type, target.Type) {
			continue
		}
		found = true
		plan.Warnings = append(plan.Warnings, localizedSyncBackendText("data_sync.backend.hint.character_length_existing", map[string]any{
			"column": target.Name, "source_type": source.Type, "target_type": target.Type,
		}))
	}
	if found && plan.PlannedAction == "表结构已一致" {
		plan.PlannedAction = localizedSyncBackendText("data_sync.backend.action.character_length_review", nil)
	}
	return plan
}

func existingCharacterColumnNames(config SyncConfig, tableName string, sourceCols []connection.ColumnDefinition) map[string]string {
	names := make(map[string]string, len(sourceCols))
	if !hasExplicitSyncMappings(config) {
		for _, col := range sourceCols {
			names[col.Name] = col.Name
		}
		return names
	}
	mapping, err := explicitSyncMappingForTable(config, tableName)
	if err != nil {
		return names
	}
	projection, err := CompileProjection(mapping)
	if err != nil {
		return names
	}
	for _, col := range sourceCols {
		if target, ok := projection.TargetColumn(col.Name); ok {
			names[col.Name] = target
		}
	}
	return names
}

func characterLengthMayNarrow(sourceType, targetType string) bool {
	source, sourceOK := parseMigrationCharacterType(sourceType)
	target, targetOK := parseMigrationCharacterType(targetType)
	if !sourceOK || !targetOK {
		return false
	}
	if target.gaussLengthUnit() == "CHAR" {
		return target.length < source.length
	}
	// Division avoids overflow for malformed or very large declared source lengths.
	// Unqualified targets may be byte-counted; BYTE sources can also grow on encoding conversion.
	return source.length > target.length/byteLengthWidenFactor
}
