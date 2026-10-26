package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

type fixtureProcess struct {
	command *exec.Cmd
	input   io.WriteCloser
	scanner *bufio.Scanner
	cancel  context.CancelFunc
	waited  bool
}

func TestFailureFixtures(t *testing.T) {
	executable := buildFixture(t)
	for _, mode := range []string{"crash", "hang", "ignore-cancel", "flood"} {
		t.Run(mode, func(t *testing.T) {
			process := startFixture(t, executable, mode)
			if mode == "hang" {
				process.send(t, `{"jsonrpc":"2.0","id":1,"method":"plugin.initialize","params":{}}`)
				if process.scanner.Scan() {
					t.Fatal("hang fixture unexpectedly initialized")
				}
				if err := process.wait(); err == nil {
					t.Fatal("hang fixture escaped test deadline")
				}
				return
			}
			process.send(t, `{"jsonrpc":"2.0","id":1,"method":"plugin.initialize","params":{}}`)
			process.expectID(t, 1)
			process.send(t, `{"jsonrpc":"2.0","id":2,"method":"plugin.invoke","params":{"commandId":"run","arguments":{}}}`)
			switch mode {
			case "crash":
				var exit *exec.ExitError
				err := process.wait()
				if !errors.As(err, &exit) || exit.ExitCode() != 23 {
					t.Fatalf("crash outcome: %v", err)
				}
			case "ignore-cancel":
				process.send(t, `{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":2}}`)
				process.send(t, `{"jsonrpc":"2.0","id":3,"method":"plugin.shutdown","params":{}}`)
				process.send(t, `{"jsonrpc":"2.0","id":4,"method":"plugin.ping","params":{}}`)
				process.expectID(t, 4)
			case "flood":
				if process.scanner.Scan() || process.scanner.Err() == nil {
					t.Fatal("flood did not exceed the bounded reader")
				}
			}
		})
	}
}

func buildFixture(t *testing.T) string {
	t.Helper()
	executable := filepath.Join(t.TempDir(), "failure")
	if runtime.GOOS == "windows" {
		executable += ".exe"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "go", "build", "-o", executable, ".")
	command.Env = append(os.Environ(), "GOWORK=off", "GOPROXY=off", "GOSUMDB=off")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("build fixture: %v\n%s", err, output)
	}
	return executable
}

func startFixture(t *testing.T, executable, mode string) *fixtureProcess {
	t.Helper()
	timeout := 3 * time.Second
	if mode == "hang" {
		timeout = 300 * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	command := exec.CommandContext(ctx, executable, "--mode", mode)
	input, err := command.StdinPipe()
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	output, err := command.StdoutPipe()
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		cancel()
		t.Fatal(err)
	}
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 4096), 16384)
	process := &fixtureProcess{command: command, input: input, scanner: scanner, cancel: cancel}
	t.Cleanup(func() {
		cancel()
		if err := input.Close(); err != nil && !errors.Is(err, os.ErrClosed) {
			t.Error(err)
		}
		if !process.waited {
			err := process.wait()
			if !fixtureCleanupComplete(err, command.ProcessState) {
				t.Error(err)
			}
		}
	})
	return process
}

func fixtureCleanupComplete(err error, state *os.ProcessState) bool {
	if err == nil {
		return true
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return true
	}
	// Windows cancellation can race the fixture's successful EOF exit. Only a
	// definitive successful Wait outcome proves that cleanup already reaped it.
	return state != nil && state.Exited() && state.Success()
}

func TestFixtureCleanupPredicate(t *testing.T) {
	const environment = "GONAVI_PLUGIN_FIXTURE_CLEANUP_EXIT"
	switch os.Getenv(environment) {
	case "success":
		os.Exit(0)
	case "failure":
		os.Exit(7)
	}
	states := make(map[string]*os.ProcessState)
	for _, mode := range []string{"success", "failure"} {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestFixtureCleanupPredicate$")
		command.Env = append(os.Environ(), environment+"="+mode)
		err := command.Run()
		cancel()
		if (err != nil) != (mode == "failure") || command.ProcessState == nil {
			t.Fatalf("fixture %s: %v", mode, err)
		}
		states[mode] = command.ProcessState
	}
	cancelErr := fmt.Errorf("exec: canceling Cmd: %w", os.ErrPermission)
	for _, test := range []struct {
		name     string
		err      error
		state    *os.ProcessState
		complete bool
	}{
		{name: "no error", complete: true},
		{name: "unknown or active process", err: cancelErr},
		{name: "successful exit already reaped", err: cancelErr, state: states["success"], complete: true},
		{name: "nonzero process does not hide cancellation failure", err: cancelErr, state: states["failure"]},
		{name: "existing exit error allowance", err: &exec.ExitError{ProcessState: states["failure"]}, state: states["failure"], complete: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := fixtureCleanupComplete(test.err, test.state); got != test.complete {
				t.Fatalf("cleanup complete=%v, want %v", got, test.complete)
			}
		})
	}
}

func (p *fixtureProcess) send(t *testing.T, frame string) {
	t.Helper()
	if _, err := fmt.Fprintln(p.input, frame); err != nil {
		t.Fatal(err)
	}
}

func (p *fixtureProcess) expectID(t *testing.T, want int) {
	t.Helper()
	if !p.scanner.Scan() {
		t.Fatalf("missing response %d: %v", want, p.scanner.Err())
	}
	var response struct {
		ID int `json:"id"`
	}
	if err := json.Unmarshal(p.scanner.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.ID != want {
		t.Fatalf("response id=%d, want %d", response.ID, want)
	}
}

func (p *fixtureProcess) wait() error {
	p.waited = true
	return p.command.Wait()
}
