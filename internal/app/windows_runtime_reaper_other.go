//go:build !windows

package app

func HandleWindowsRuntimeReaperArgs([]string) bool { return false }

func StartWindowsRuntimeProcessReaper() {}

func ReapOrphanedWindowsWebViewProcesses() {}
