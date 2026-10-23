package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/plugin"
)

type fakePluginRuntime struct {
	statuses       []plugin.Status
	starts         int
	closes         int
	calls          []string
	install        plugin.InstallRequest
	enabled        bool
	purged         bool
	startErr       error
	invokeErr      error
	invoked        string
	remainStarting bool
}

func (f *fakePluginRuntime) Start(context.Context) error {
	f.starts++
	if f.startErr != nil {
		return f.startErr
	}
	if !f.remainStarting && len(f.statuses) > 0 {
		f.statuses[0].State = plugin.StateRunning
	}
	return nil
}
func (f *fakePluginRuntime) Close(context.Context) error { f.closes++; return nil }
func (f *fakePluginRuntime) List() []plugin.Status       { return f.statuses }
func (f *fakePluginRuntime) Inspect(context.Context, string) (plugin.Inspection, error) {
	f.calls = append(f.calls, "inspect")
	return plugin.Inspection{Digest: strings.Repeat("a", 64)}, nil
}
func (f *fakePluginRuntime) Install(_ context.Context, request plugin.InstallRequest) (plugin.Status, error) {
	f.calls = append(f.calls, "install")
	f.install = request
	return plugin.Status{}, nil
}
func (f *fakePluginRuntime) ReplacePackage(_ context.Context, request plugin.InstallRequest) (plugin.Status, error) {
	f.calls = append(f.calls, "replace")
	f.install = request
	return plugin.Status{}, nil
}
func (f *fakePluginRuntime) SetEnabled(_ context.Context, _ string, enabled bool) (plugin.Status, error) {
	f.calls = append(f.calls, "enabled")
	f.enabled = enabled
	return plugin.Status{DesiredEnabled: enabled}, nil
}
func (f *fakePluginRuntime) Remove(_ context.Context, _ string, purge bool) error {
	f.calls = append(f.calls, "remove")
	f.purged = purge
	return nil
}
func (f *fakePluginRuntime) Invoke(ctx context.Context, _ string, command string, _ json.RawMessage) (json.RawMessage, error) {
	f.calls = append(f.calls, "invoke")
	f.invoked = command
	if f.invokeErr != nil {
		return nil, f.invokeErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return json.RawMessage(`{"message":"hello"}`), nil
}

func testPluginCLI(t *testing.T, args []string, fake *fakePluginRuntime) (int, string, string, plugin.Options) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	var received plugin.Options
	code := runPluginWithFactory(context.Background(), args, &stdout, &stderr, func(options plugin.Options) (pluginRuntime, error) { received = options; return fake, nil })
	return code, stdout.String(), stderr.String(), received
}

func TestPluginControlsDoNotStartRuntime(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	for _, tt := range []struct {
		name string
		args []string
		call string
	}{
		{name: "list", args: []string{"list"}},
		{name: "inspect", args: []string{"inspect", "package"}, call: "inspect"},
		{name: "check", args: []string{"check", "package"}, call: "inspect"},
		{name: "install", args: []string{"install", "--digest", strings.Repeat("a", 64), "--trust", "package"}, call: "install"},
		{name: "replace", args: []string{"replace", "--digest", strings.Repeat("a", 64), "--trust", "package"}, call: "replace"},
		{name: "enable", args: []string{"enable", "example.hello"}, call: "enabled"},
		{name: "disable", args: []string{"disable", "example.hello"}, call: "enabled"},
		{name: "remove", args: []string{"remove", "--purge", "example.hello"}, call: "remove"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakePluginRuntime{}
			args := append([]string{"--root", t.TempDir()}, tt.args...)
			code, stdout, stderr, _ := testPluginCLI(t, args, fake)
			if code != ExitSuccess || stderr != "" || !json.Valid([]byte(stdout)) {
				t.Fatalf("exit=%d stdout=%s stderr=%s", code, stdout, stderr)
			}
			if fake.starts != 0 || fake.closes != 1 {
				t.Fatalf("unexpected lifecycle: %+v", fake)
			}
			if tt.call != "" && (len(fake.calls) != 1 || fake.calls[0] != tt.call) {
				t.Fatalf("calls: %v", fake.calls)
			}
			if tt.name == "install" && (!fake.install.Trusted || fake.install.Digest != strings.Repeat("a", 64)) {
				t.Fatal("trust or digest lost")
			}
			if tt.name == "enable" && !fake.enabled {
				t.Fatal("enable intent lost")
			}
			if tt.name == "remove" && !fake.purged {
				t.Fatal("purge intent lost")
			}
		})
	}
}

func TestPluginSafeModeIsFailClosed(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "1")
	for _, command := range []string{"enable", "invoke", "disable", "list"} {
		t.Run(command, func(t *testing.T) {
			fake := &fakePluginRuntime{}
			args := []string{command, "--root", t.TempDir(), "--safe-mode=false"}
			if command != "list" {
				args = append(args, "example.hello")
			}
			if command == "invoke" {
				args = append(args, "hello")
			}
			code, _, stderr, options := testPluginCLI(t, args, fake)
			if command == "enable" || command == "invoke" {
				if code != ExitPolicyDenied || !strings.Contains(stderr, "plugin_safe_mode") || fake.closes != 0 {
					t.Fatalf("unsafe execution: %d %s", code, stderr)
				}
				return
			}
			if code != ExitSuccess || !options.Disabled || fake.starts != 0 {
				t.Fatalf("management unavailable: %d %s", code, stderr)
			}
		})
	}
}

func TestPluginArgumentErrorsHaveNoEffects(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	for _, args := range [][]string{
		{"unknown"}, {"install", "package"}, {"install", "--digest", "bad", "--trust", "package"},
		{"install", "--digest", strings.Repeat("a", 64), "package"},
		{"invoke", "--args", "{", "example.hello", "hello"},
		{"invoke", "--timeout", "0s", "example.hello", "hello"},
		{"remove", "example.hello", "--purge"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			fake := &fakePluginRuntime{}
			code, _, _, _ := testPluginCLI(t, args, fake)
			if code != ExitUsage || fake.closes != 0 || len(fake.calls) != 0 {
				t.Fatalf("invalid args had effects: %d %+v", code, fake)
			}
		})
	}
}

func TestPluginInvokeLifecycle(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	for _, tt := range []struct {
		name     string
		enabled  bool
		startErr error
		wait     bool
		want     int
	}{
		{name: "success", enabled: true, want: ExitSuccess},
		{name: "disabled", want: ExitPolicyDenied},
		{name: "owner held", enabled: true, startErr: plugin.ErrLocked, want: ExitExecution},
		{name: "startup deadline", enabled: true, wait: true, want: ExitCancelled},
	} {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakePluginRuntime{statuses: []plugin.Status{{Manifest: plugin.Manifest{ID: "example.hello"}, DesiredEnabled: tt.enabled, State: plugin.StateStarting}}, startErr: tt.startErr, remainStarting: tt.wait}
			code, stdout, stderr, _ := testPluginCLI(t, []string{"invoke", "--root", t.TempDir(), "--timeout", "10ms", "example.hello", "hello"}, fake)
			if code != tt.want || fake.closes != 1 {
				t.Fatalf("exit=%d stdout=%s stderr=%s lifecycle=%+v", code, stdout, stderr, fake)
			}
			if !tt.enabled && fake.starts != 0 {
				t.Fatal("invocation enabled a disabled plugin")
			}
			if tt.startErr != nil && len(fake.calls) != 0 {
				t.Fatal("invoke retried after owner failure")
			}
		})
	}
}

func TestPluginCancelledAndMissingLifecycle(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	factory := func(plugin.Options) (pluginRuntime, error) {
		called = true
		return nil, errors.New("unexpected construction")
	}
	if code := runPluginWithFactory(ctx, []string{"list"}, nil, nil, factory); code != ExitCancelled {
		t.Fatalf("cancelled=%d", code)
	}
	if code := runPluginWithFactory(nil, []string{"list"}, nil, nil, factory); code != ExitUsage {
		t.Fatalf("nil context=%d", code)
	}
	if called {
		t.Fatal("created runtime without lifecycle")
	}
}

func TestPluginStartupWaitObservesCancellation(t *testing.T) {
	fake := &fakePluginRuntime{statuses: []plugin.Status{{Manifest: plugin.Manifest{ID: "example.hello"}, DesiredEnabled: true, State: plugin.StateStarting}}}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	if err := waitPluginRunning(ctx, fake, "example.hello"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("wait=%v", err)
	}
}
