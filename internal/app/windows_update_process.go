package app

import (
	"context"
	"fmt"
	"strings"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func otherWindowsUpdateProcessIDs(processes []windowsUpdateProcess) []uint32 {
	result := make([]uint32, 0, len(processes))
	for _, process := range processes {
		result = append(result, process.PID)
	}
	return result
}

func windowsUpdateCloseConfirmationRequired(goos string, confirmed bool, otherInstanceCount int) bool {
	return strings.EqualFold(strings.TrimSpace(goos), "windows") && !confirmed && otherInstanceCount > 0
}

func showWindowsUpdateCloseConfirmation(ctx context.Context, title, message string) (bool, error) {
	if ctx == nil {
		return false, fmt.Errorf("application window is not ready")
	}
	response, err := wailsRuntime.MessageDialog(ctx, wailsRuntime.MessageDialogOptions{
		Type:          wailsRuntime.QuestionDialog,
		Title:         title,
		Message:       message,
		Buttons:       []string{"Yes", "No"},
		DefaultButton: "No",
		CancelButton:  "No",
	})
	if err != nil {
		return false, err
	}
	return strings.EqualFold(strings.TrimSpace(response), "yes"), nil
}

func closeOtherWindowsUpdateInstancesForInstall(targetPaths []string, currentPID int) ([]uint32, error) {
	instances, err := updateFindOtherWindowsInstances(targetPaths, currentPID)
	if err != nil {
		return nil, err
	}
	pids := otherWindowsUpdateProcessIDs(instances)
	if len(instances) == 0 {
		return pids, nil
	}
	if err := updateCloseWindowsInstances(instances); err != nil {
		return pids, err
	}
	remaining, err := updateFindOtherWindowsInstances(targetPaths, currentPID)
	if err != nil {
		return pids, err
	}
	if len(remaining) > 0 {
		return pids, fmt.Errorf("GoNavi processes still running after close: %v", otherWindowsUpdateProcessIDs(remaining))
	}
	return pids, nil
}
