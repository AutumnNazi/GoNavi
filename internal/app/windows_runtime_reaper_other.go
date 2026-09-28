//go:build !windows

package app

func HandleWindowsRuntimeReaperArgs([]string) bool { return false }

// HandleWindowsUpdateCleanupArgs is unavailable outside Windows.
func HandleWindowsUpdateCleanupArgs([]string) bool { return false }

func StartWindowsRuntimeProcessReaper() {}

func ReapOrphanedWindowsWebViewProcesses() {}
