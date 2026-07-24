package app

import (
	_ "embed"
	"strings"
)

//go:embed windows_update.ps1
var windowsUpdatePowerShellScript string

type windowsUpdateLaunchContext struct {
	SourcePath           string
	TargetPath           string
	CurrentTargetPath    string
	StagedDir            string
	LogPath              string
	MaintenanceEventName string
	HandoffEventName     string
	PID                  int
}

func buildWindowsPowerShellScript() string {
	normalized := strings.ReplaceAll(windowsUpdatePowerShellScript, "\r\n", "\n")
	return strings.ReplaceAll(normalized, "\n", "\r\n")
}
