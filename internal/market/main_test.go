package market

import (
	"fmt"
	"os"
	"testing"

	"GoNavi-Wails/internal/logger"
)

func TestMain(m *testing.M) {
	directory, err := os.MkdirTemp("", "gonavi-market-test-logs-")
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot create isolated market test logs")
		os.Exit(2)
	}
	if err = os.Setenv("GONAVI_LOG_DIR", directory); err != nil {
		if removeErr := os.RemoveAll(directory); removeErr != nil {
			fmt.Fprintln(os.Stderr, "cannot remove market test log directory")
		}
		fmt.Fprintln(os.Stderr, "cannot isolate market test logs")
		os.Exit(2)
	}
	code := m.Run()
	logger.Close()
	if err = os.RemoveAll(directory); err != nil {
		fmt.Fprintln(os.Stderr, "cannot remove market test log directory")
		code = 1
	}
	os.Exit(code)
}
