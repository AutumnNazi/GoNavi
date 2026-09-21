package app

import (
	"context"
	"strings"

	"GoNavi-Wails/internal/uievents"
)

const driverDownloadProgressEvent = "driver:download-progress"

type driverDownloadProgressPayload struct {
	TaskID     string  `json:"taskId,omitempty"`
	DriverType string  `json:"driverType"`
	Status     string  `json:"status"`
	Percent    float64 `json:"percent"`
	Downloaded int64   `json:"downloaded"`
	Total      int64   `json:"total"`
	Message    string  `json:"message,omitempty"`
}

// emitDriverDownloadProgress reports progress for the currently active task of
// a driver type. Callers that own a task context should prefer
// emitDriverDownloadProgressContext so late events from a canceled worker are
// dropped instead of being attributed to a newer task of the same driver.
func (a *App) emitDriverDownloadProgress(driverType string, status string, downloaded, total int64, message string) {
	a.emitDriverDownloadProgressContext(context.Background(), driverType, status, downloaded, total, message)
}

func (a *App) emitDriverDownloadProgressContext(ctx context.Context, driverType string, status string, downloaded, total int64, message string) {
	if a == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	taskID := driverDownloadTaskIDFromContext(ctx)
	if taskID != "" && ctx.Err() != nil {
		return
	}
	payload := buildDriverDownloadProgressPayload(driverType, status, downloaded, total, message)
	payload.TaskID = a.updateDriverDownloadTaskProgressForTask(taskID, driverType, payload.Status, payload.Percent, payload.Message)
	if taskID != "" && payload.TaskID == "" {
		// The task already reached a terminal state (canceled or finished);
		// its worker is winding down and must not touch the UI anymore.
		return
	}
	if a.ctx == nil {
		return
	}
	uievents.Emit(a.ctx, driverDownloadProgressEvent, payload)
}

func buildDriverDownloadProgressPayload(driverType string, status string, downloaded, total int64, message string) driverDownloadProgressPayload {
	payload := driverDownloadProgressPayload{
		DriverType: normalizeDriverType(driverType),
		Status:     strings.TrimSpace(status),
		Downloaded: downloaded,
		Total:      total,
		Message:    strings.TrimSpace(message),
	}
	if payload.DriverType == "" {
		payload.DriverType = "unknown"
	}
	if payload.Status == "" {
		payload.Status = "downloading"
	}
	if total > 0 {
		payload.Percent = clampDriverDownloadTaskPercent((float64(downloaded) / float64(total)) * 100)
	}
	if payload.Status == "done" && payload.Percent < 100 {
		payload.Percent = 100
	}
	return payload
}

func (a *App) emitDriverDownloadTaskSnapshot(task DriverDownloadTaskStatus) {
	if a == nil || a.ctx == nil {
		return
	}
	uievents.Emit(a.ctx, driverDownloadProgressEvent, driverDownloadProgressPayload{
		TaskID:     task.TaskID,
		DriverType: task.DriverType,
		Status:     task.Status,
		Percent:    task.Percent,
		Message:    task.Message,
	})
}
