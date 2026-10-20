package aiservice

import (
	"fmt"
	"os"
	"testing"

	"GoNavi-Wails/internal/logger"
)

// Package tests exercise failure paths that log a warning or an error, so the
// log must never point at the user's real GoNavi log file.
func TestMain(m *testing.M) {
	testLogDir, err := os.MkdirTemp("", "gonavi-aiservice-log-")
	if err != nil {
		fmt.Fprintf(os.Stderr, "create AI service test log directory: %v\n", err)
		os.Exit(2)
	}
	_ = os.Setenv("GONAVI_LOG_DIR", testLogDir)
	logger.Init()

	code := m.Run()
	logger.Close()
	_ = os.RemoveAll(testLogDir)
	os.Exit(code)
}
