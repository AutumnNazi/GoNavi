package sync

import (
	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

// targetNeedsSingleKindBatches 报告目标库是否要求每次提交只含一类写入（描述表 sync.singleKindBatches）。
func targetNeedsSingleKindBatches(target connection.ConnectionConfig) bool {
	spec, ok := db.DataSourceSpec(target.Type)
	return ok && spec.Sync != nil && spec.Sync.SingleKindBatches
}

// applyChangesByKind 依次提交删除、修改、新增：每一类按批大小分批，彼此是独立的提交，
// 与普通分批一样在失败时报告此前已确认提交的数量。
func (s *SyncEngine) applyChangesByKind(config SyncConfig, res *SyncResult, targetTable string, applier db.BatchApplier, changes connection.ChangeSet) (appliedChangeCounts, error) {
	total := appliedChangeCounts{}
	for _, part := range []connection.ChangeSet{
		{LocatorStrategy: changes.LocatorStrategy, Deletes: changes.Deletes},
		{LocatorStrategy: changes.LocatorStrategy, Updates: changes.Updates},
		{LocatorStrategy: changes.LocatorStrategy, Inserts: changes.Inserts},
	} {
		applied, err := s.applyChangesInBatches(config.JobID, res, targetTable, applier, part, config.BatchSize)
		total.Inserts += applied.Inserts
		total.Updates += applied.Updates
		total.Deletes += applied.Deletes
		if err != nil {
			return total, err
		}
	}
	return total, nil
}
