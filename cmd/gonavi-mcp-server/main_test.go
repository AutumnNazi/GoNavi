package main

import (
	"errors"
	"os"
	"os/exec"
	"testing"
)

func TestMainReturnsNonZeroForStartupFailure(t *testing.T) {
	const helperEnv = "GONAVI_MCP_MAIN_FAILURE_HELPER"
	if os.Getenv(helperEnv) == "1" {
		os.Args = []string{"gonavi-mcp-server", "invalid-mode"}
		main()
		return
	}

	cmd := exec.Command(os.Args[0], "-test.run=^TestMainReturnsNonZeroForStartupFailure$")
	cmd.Env = append(os.Environ(), helperEnv+"=1")
	err := cmd.Run()
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("main returned success for a startup failure: %v", err)
	}
	if exitErr.ExitCode() != 1 {
		t.Fatalf("startup failure exit code = %d, want 1", exitErr.ExitCode())
	}
}
