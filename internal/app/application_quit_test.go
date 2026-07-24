package app

import (
	"context"
	"testing"
	"time"
)

func TestApplicationBeforeCloseEmitsPromptOnceUntilCancelled(t *testing.T) {
	originalEmit := emitApplicationBeforeCloseRequest
	originalQuit := quitApplicationRuntime
	t.Cleanup(func() {
		emitApplicationBeforeCloseRequest = originalEmit
		quitApplicationRuntime = originalQuit
	})

	var emitted []string
	emitApplicationBeforeCloseRequest = func(_ context.Context, eventName string, _ ...interface{}) {
		emitted = append(emitted, eventName)
	}
	quitApplicationRuntime = func(context.Context) {}

	app := NewAppWithSecretStore(nil)
	handler := NewBeforeCloseHandler(app)

	if prevent := handler(context.Background()); !prevent {
		t.Fatal("expected first close request to be prevented")
	}
	if len(emitted) != 1 || emitted[0] != applicationBeforeCloseRequestEvent {
		t.Fatalf("expected one before-close event, got %#v", emitted)
	}
	if prevent := handler(context.Background()); !prevent {
		t.Fatal("expected repeated close request to stay prevented while prompt is open")
	}
	if len(emitted) != 1 {
		t.Fatalf("expected no duplicate prompt event, got %#v", emitted)
	}

	result := app.CancelApplicationQuit()
	if !result.Success {
		t.Fatalf("expected cancel quit success, got %#v", result)
	}
	if prevent := handler(context.Background()); !prevent {
		t.Fatal("expected close request after cancellation to be prevented again")
	}
	if len(emitted) != 2 {
		t.Fatalf("expected prompt event after cancellation, got %#v", emitted)
	}
}

func TestForceQuitApplicationAllowsNextCloseRequest(t *testing.T) {
	originalEmit := emitApplicationBeforeCloseRequest
	originalQuit := quitApplicationRuntime
	t.Cleanup(func() {
		emitApplicationBeforeCloseRequest = originalEmit
		quitApplicationRuntime = originalQuit
	})

	emitApplicationBeforeCloseRequest = func(context.Context, string, ...interface{}) {}
	quitCalls := 0
	quitApplicationRuntime = func(context.Context) {
		quitCalls++
	}

	app := NewAppWithSecretStore(nil)
	app.ctx = context.Background()
	if result := app.ForceQuitApplication(); !result.Success {
		t.Fatalf("expected force quit success, got %#v", result)
	}
	if quitCalls != 1 {
		t.Fatalf("expected runtime Quit to be called once, got %d", quitCalls)
	}
	if prevent := NewBeforeCloseHandler(app)(context.Background()); prevent {
		t.Fatal("expected next close request to be allowed after force quit")
	}
}

func TestInstallUpdateAndRestartAllowsGuardedCloseBeforeFallbackExit(t *testing.T) {
	originalEmit := emitApplicationBeforeCloseRequest
	originalQuit := quitApplicationRuntime
	originalResolveInstallTarget := updateResolveInstallTarget
	originalLaunchInstallScript := updateLaunchInstallScript
	originalAcquireMaintenance := updateAcquireWindowsMaintenance
	originalSleep := updateQuitSleep
	originalExit := updateExitProcess
	t.Cleanup(func() {
		emitApplicationBeforeCloseRequest = originalEmit
		quitApplicationRuntime = originalQuit
		updateResolveInstallTarget = originalResolveInstallTarget
		updateLaunchInstallScript = originalLaunchInstallScript
		updateAcquireWindowsMaintenance = originalAcquireMaintenance
		updateQuitSleep = originalSleep
		updateExitProcess = originalExit
	})

	app := NewAppWithSecretStore(nil)
	app.ctx = context.Background()
	stagedDir := t.TempDir()
	app.updateState.staged = &stagedUpdate{
		FilePath:     stagedDir + "/GoNavi-update.exe",
		StagedDir:    stagedDir,
		InstallMode:  updateInstallModePortable,
		PackageType:  updatePackageTypePortable,
		AutoRelaunch: true,
	}

	events := make(chan string, 3)
	promptEvents := make(chan struct{}, 1)
	guardResults := make(chan bool, 1)
	sleepDurations := make(chan time.Duration, 2)
	exitCodes := make(chan int, 1)
	emitApplicationBeforeCloseRequest = func(context.Context, string, ...interface{}) {
		promptEvents <- struct{}{}
	}
	quitApplicationRuntime = func(ctx context.Context) {
		events <- "quit"
		guardResults <- app.beforeClose(ctx)
	}
	updateResolveInstallTarget = func() string {
		return stagedDir + "/GoNavi.exe"
	}
	updateLaunchInstallScript = func(*stagedUpdate) error {
		events <- "installer"
		return nil
	}
	updateAcquireWindowsMaintenance = func(string) (windowsUpdateMaintenanceLease, error) {
		return windowsUpdateMaintenanceLease{Name: `Global\GoNavi-Update-Test`}, nil
	}
	updateQuitSleep = func(duration time.Duration) {
		sleepDurations <- duration
	}
	updateExitProcess = func(code int) {
		events <- "exit"
		exitCodes <- code
	}

	result := app.InstallUpdateAndRestart(true)
	if !result.Success {
		t.Fatalf("expected update installation to start, got %#v", result)
	}

	for index, want := range []string{"installer", "quit", "exit"} {
		select {
		case got := <-events:
			if got != want {
				t.Fatalf("event %d = %q, want %q", index, got, want)
			}
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for %q event", want)
		}
	}

	if prevented := <-guardResults; prevented {
		t.Fatal("expected updater-controlled close to bypass the normal close prompt")
	}
	select {
	case <-promptEvents:
		t.Fatal("expected no before-close prompt during update restart")
	default:
	}
	if exitCode := <-exitCodes; exitCode != 0 {
		t.Fatalf("expected fallback exit code 0, got %d", exitCode)
	}
	for index, want := range []time.Duration{300 * time.Millisecond, 35 * time.Second} {
		if got := <-sleepDurations; got != want {
			t.Fatalf("quit sleep %d = %s, want %s", index, got, want)
		}
	}
}
