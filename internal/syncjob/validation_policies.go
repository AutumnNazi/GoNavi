package syncjob

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

func validateDefinitionMappings(definition JobDefinition) error {
	seenTargets := make(map[string]struct{}, len(definition.Mappings))
	enabledMappings := 0
	for index, mapping := range definition.Mappings {
		if !mapping.Enabled {
			continue
		}
		enabledMappings++
		if (definition.Kind != JobKindBackup && mapping.TargetTable == "") || (definition.Kind != JobKindQuerySink && mapping.SourceTable == "") {
			return fmt.Errorf("table mapping %d requires a targetTable and a sourceTable unless this is a query sink", index+1)
		}
		switch mapping.TargetTableStrategy {
		case "", "existing_only", "auto_create_if_missing", "smart":
		default:
			return fmt.Errorf("table mapping %s has unsupported targetTableStrategy %q", mapping.SourceTable, mapping.TargetTableStrategy)
		}
		targetKey := strings.ToLower(mapping.TargetSchema + "\x00" + mapping.TargetTable)
		if definition.Kind == JobKindBackup {
			targetKey = strings.ToLower(mapping.SourceSchema + "\x00" + mapping.SourceTable)
		}
		if _, exists := seenTargets[targetKey]; exists {
			return fmt.Errorf("duplicate target table mapping %s", mapping.TargetTable)
		}
		seenTargets[targetKey] = struct{}{}
		if err := validateColumnMappings(mapping); err != nil {
			return fmt.Errorf("table mapping %s: %w", mapping.SourceTable, err)
		}
		if definition.IncrementalMode == IncrementalWatermark {
			if mapping.Watermark == nil || strings.TrimSpace(mapping.Watermark.Column) == "" {
				return fmt.Errorf("table mapping %s requires a watermark column", mapping.SourceTable)
			}
		}
		if definition.IncrementalMode == IncrementalCDC && len(mapping.KeyColumns) == 0 {
			return fmt.Errorf("table mapping %s requires stable keyColumns for CDC", mapping.SourceTable)
		}
	}
	if enabledMappings == 0 {
		return errors.New("at least one table mapping must be enabled")
	}
	return nil
}

func validateDefinitionPolicies(definition JobDefinition) error {
	switch definition.Schedule.Kind {
	case ScheduleManual:
	case ScheduleOnce:
		if definition.Schedule.RunAt <= 0 {
			return errors.New("one-time schedules require runAt")
		}
	case ScheduleInterval:
		if time.Duration(definition.Schedule.IntervalSeconds)*time.Second < minScheduleInterval {
			return fmt.Errorf("scheduled interval must be at least %s", minScheduleInterval)
		}
	case ScheduleCron:
		if _, err := parseCronSchedule(definition.Schedule.CronExpression, definition.Schedule.Timezone); err != nil {
			return err
		}
	case ScheduleContinuous:
		if definition.IncrementalMode != IncrementalCDC {
			return errors.New("continuous trigger requires CDC incremental mode")
		}
		if definition.ConcurrencyPolicy != "forbid" {
			return errors.New("continuous trigger requires forbid concurrency policy")
		}
	default:
		return fmt.Errorf("unsupported schedule kind %q", definition.Schedule.Kind)
	}
	switch definition.Schedule.MisfirePolicy {
	case "skip", "run_once", "catch_up":
	default:
		return fmt.Errorf("unsupported misfire policy %q", definition.Schedule.MisfirePolicy)
	}
	switch definition.ConcurrencyPolicy {
	case "forbid", "queue":
	default:
		return fmt.Errorf("unsupported concurrency policy %q", definition.ConcurrencyPolicy)
	}
	switch definition.ResumePolicy {
	case "never", "manual", "auto":
	default:
		return fmt.Errorf("unsupported resume policy %q", definition.ResumePolicy)
	}
	return nil
}
