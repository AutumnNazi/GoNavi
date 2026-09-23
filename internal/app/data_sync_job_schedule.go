package app

import (
	"time"

	"GoNavi-Wails/internal/syncjob"
)

func previewDataSyncJobSchedule(definition syncjob.JobDefinition, now time.Time, count int) []int64 {
	if count < 1 || count > 20 {
		count = 5
	}
	result := make([]int64, 0, count)
	after := now
	for len(result) < count {
		next := syncjob.NextRunAt(definition, after)
		if next <= 0 {
			break
		}
		result = append(result, next)
		after = time.UnixMilli(next)
		if definition.Schedule.Kind == syncjob.ScheduleOnce {
			break
		}
	}
	return result
}
