package syncjob

import (
	"errors"
	"path/filepath"
	"strings"
)

// BackupSpec describes an independent SQL export for every task run.
// Completed files are retained until explicitly removed by the user.
type BackupSpec struct {
	Directory string `json:"directory"`
	Content   string `json:"content"`
}

func validateBackupDefinition(definition JobDefinition) error {
	if definition.Backup == nil || !filepath.IsAbs(strings.TrimSpace(definition.Backup.Directory)) {
		return errors.New("backup requires an absolute output directory")
	}
	switch definition.Backup.Content {
	case "schema", "data", "both":
	default:
		return errors.New("backup content must be schema, data, or both")
	}
	if definition.Target.ConnectionID != "" || definition.IncrementalMode != IncrementalSnapshot || definition.SourceQuery != "" {
		return errors.New("backup requires a table snapshot without a target connection")
	}
	if definition.Options.ErrorPolicy != ErrorPolicyStop || definition.Options.PropagateDeletes || definition.Options.CaptureErrorPayload {
		return errors.New("backup must stop on errors and cannot mutate a target")
	}
	for _, mapping := range definition.Mappings {
		if mapping.Enabled && (mapping.Filter != "" || len(mapping.Columns) != 0) {
			return errors.New("backup does not support row filters or column transforms")
		}
	}
	return nil
}
