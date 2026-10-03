package syncworker

import (
	"context"
	"os"
	"os/exec"
	"testing"
	"time"
)

// TestMain provides a worker-mode entry only inside this disposable test binary.
func TestMain(m *testing.M) {
	if os.Getenv("GONAVI_SYNCWORKER_TEST") == "1" && len(os.Args) > 2 {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		switch os.Args[1] {
		case "sync-worker":
			if len(os.Args) != 4 || os.Args[2] != "--data-root" {
				os.Exit(2)
			}
			if err := Run(ctx, os.Args[3], func(context.Context) (func(), error) { return func() {}, nil }); err != nil {
				os.Exit(3)
			}
			return
		case "launch-test-worker":
			executable, err := os.Executable()
			if err != nil {
				os.Exit(4)
			}
			if err := Ensure(ctx, os.Args[2], executable); err != nil {
				os.Exit(5)
			}
			return
		}
	}
	os.Exit(m.Run())
}

func TestDetachedWorkerSurvivesLauncherExit(t *testing.T) {
	t.Setenv("GONAVI_SYNCWORKER_TEST", "1")
	root := t.TempDir()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	defer func() {
		if err := Stop(ctx, root); err != nil {
			t.Error(err)
		}
	}()
	command := exec.CommandContext(ctx, executable, "launch-test-worker", root)
	detach(command)
	if err := command.Run(); err != nil {
		t.Fatalf("launcher failed: %v", err)
	}
	if !healthy(ctx, root) {
		t.Fatal("worker stopped with its launching parent")
	}
	if err := Stop(ctx, root); err != nil {
		t.Fatal(err)
	}
	if healthy(ctx, root) {
		t.Fatal("worker still running after stop")
	}
}
