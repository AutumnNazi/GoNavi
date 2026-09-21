package app

import (
	"context"
	"os"
	"os/exec"
	"sync"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/uievents"
)

type driverProgressEventRecorder struct {
	mu     sync.Mutex
	events []driverDownloadProgressPayload
}

func (r *driverProgressEventRecorder) Emit(name string, args ...any) {
	if name != driverDownloadProgressEvent || len(args) != 1 {
		return
	}
	payload, ok := args[0].(driverDownloadProgressPayload)
	if !ok {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, payload)
}

func (r *driverProgressEventRecorder) snapshot() []driverDownloadProgressPayload {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]driverDownloadProgressPayload(nil), r.events...)
}

func waitForDriverDownloadTaskToFinish(t *testing.T, app *App, taskID string, timeout time.Duration) DriverDownloadTaskStatus {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		listed := app.ListDriverDownloadTasks()
		tasks, _ := listed.Data.([]DriverDownloadTaskStatus)
		for _, task := range tasks {
			if task.TaskID == taskID && !task.Running {
				return task
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("task %s did not finish within %s: %#v", taskID, timeout, listed.Data)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestCancelDriverPackageDownloadDropsLateProgressAndAllowsRestart(t *testing.T) {
	app := NewApp()
	recorder := &driverProgressEventRecorder{}
	app.ctx = uievents.WithEmitter(context.Background(), recorder)

	started := make(chan struct{})
	runnerReturned := make(chan struct{})
	app.driverDownloadTaskRunner = func(ctx context.Context, driverType string, _ string, _ string, _ string) connection.QueryResult {
		app.emitDriverDownloadProgressContext(ctx, driverType, "downloading", 30, 100, "downloading before cancel")
		close(started)
		<-ctx.Done()
		app.emitDriverDownloadProgressContext(ctx, driverType, "downloading", 99, 100, "late progress")
		app.emitDriverDownloadProgressContext(ctx, driverType, "done", 100, 100, "late done")
		close(runnerReturned)
		return connection.QueryResult{Success: true, Message: "late success"}
	}

	first := app.StartDriverPackageDownload("duckdb", "2.5.6", "builtin://activate/duckdb", t.TempDir())
	if !first.Success {
		t.Fatalf("start background driver download failed: %#v", first)
	}
	firstTask := first.Data.(map[string]interface{})["task"].(DriverDownloadTaskStatus)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("background driver download did not start")
	}

	cancelResult := app.CancelDriverPackageDownload(firstTask.TaskID)
	if !cancelResult.Success {
		t.Fatalf("cancel driver download failed: %#v", cancelResult)
	}
	select {
	case <-runnerReturned:
	case <-time.After(time.Second):
		t.Fatal("runner did not observe cancellation")
	}
	finished := waitForDriverDownloadTaskToFinish(t, app, firstTask.TaskID, time.Second)
	if finished.Status != "canceled" || finished.Percent != 30 {
		t.Fatalf("canceled task = %#v, want status=canceled percent=30", finished)
	}

	for _, event := range recorder.snapshot() {
		if event.TaskID != firstTask.TaskID {
			continue
		}
		if event.Message == "late progress" || event.Message == "late done" || event.Status == "done" {
			t.Fatalf("late progress from the canceled worker reached the UI: %#v", event)
		}
	}

	app.driverDownloadTaskRunner = func(ctx context.Context, _ string, _ string, _ string, _ string) connection.QueryResult {
		return connection.QueryResult{Success: true, Message: "second run"}
	}
	second := app.StartDriverPackageDownload("duckdb", "2.5.6", "builtin://activate/duckdb", t.TempDir())
	if !second.Success {
		t.Fatalf("restart after cancel failed: %#v", second)
	}
	if second.Data.(map[string]interface{})["alreadyRunning"].(bool) {
		t.Fatalf("canceled task still blocks new downloads: %#v", second.Data)
	}
	secondTask := second.Data.(map[string]interface{})["task"].(DriverDownloadTaskStatus)
	if secondTask.TaskID == firstTask.TaskID {
		t.Fatal("restart reused the canceled task id")
	}
	if done := waitForDriverDownloadTaskToFinish(t, app, secondTask.TaskID, time.Second); done.Status != "done" {
		t.Fatalf("second task = %#v, want status=done", done)
	}
}

func TestStartDriverPackageDownloadCancelInterruptsRealDownloadWithoutSourceBuildFallback(t *testing.T) {
	originalValidate := validateOptionalDriverAgentExecutableFunc
	originalLookPath := goBinaryLookPath
	originalStat := goBinaryStat
	originalCommandOutput := goBinaryCommandOutput
	t.Cleanup(func() {
		validateOptionalDriverAgentExecutableFunc = originalValidate
		goBinaryLookPath = originalLookPath
		goBinaryStat = originalStat
		goBinaryCommandOutput = originalCommandOutput
	})
	validateOptionalDriverAgentExecutableFunc = func(string, string) error { return nil }
	goBinaryLookPath = func(string) (string, error) { return "", os.ErrNotExist }
	goBinaryStat = func(string) (os.FileInfo, error) { return nil, os.ErrNotExist }
	goBinaryCommandOutput = func(*exec.Cmd) ([]byte, error) { return nil, os.ErrNotExist }
	chdirTemp(t)
	disableGlobalProxyForTest(t)
	server, downloading, released := newStallingDownloadServer(t)

	app := NewApp()
	recorder := &driverProgressEventRecorder{}
	app.ctx = uievents.WithEmitter(context.Background(), recorder)
	driverRoot := t.TempDir()

	// 1.9.7 differs from the pinned version, so the install is restricted to
	// this explicit artifact and never consults published release URLs.
	started := app.StartDriverPackageDownload("sqlserver", "1.9.7", server.URL+"/sqlserver-driver-agent-1.9.7.zip", driverRoot)
	if !started.Success {
		t.Fatalf("start background driver download failed: %#v", started)
	}
	task := started.Data.(map[string]interface{})["task"].(DriverDownloadTaskStatus)
	select {
	case <-downloading:
	case <-time.After(10 * time.Second):
		t.Fatalf("driver download never reached the HTTP server: tasks=%#v events=%#v", app.ListDriverDownloadTasks().Data, recorder.snapshot())
	}

	canceledAt := time.Now()
	cancelResult := app.CancelDriverPackageDownload(task.TaskID)
	if !cancelResult.Success {
		t.Fatalf("cancel driver download failed: %#v", cancelResult)
	}
	select {
	case <-released:
	case <-time.After(5 * time.Second):
		t.Fatal("cancellation did not interrupt the in-flight HTTP download")
	}
	finished := waitForDriverDownloadTaskToFinish(t, app, task.TaskID, 10*time.Second)
	if finished.Status != "canceled" {
		t.Fatalf("task after cancel = %#v, want status=canceled", finished)
	}
	if elapsed := time.Since(canceledAt); elapsed > 5*time.Second {
		t.Fatalf("worker took %s to stop after cancellation", elapsed)
	}
	for _, event := range recorder.snapshot() {
		if event.TaskID == task.TaskID && event.Status == "error" {
			t.Fatalf("canceled download surfaced as an error to the UI: %#v", event)
		}
	}
	if _, err := os.Stat(installedDriverMetaPath(driverRoot, "sqlserver")); !os.IsNotExist(err) {
		t.Fatalf("canceled download wrote driver metadata, stat err=%v", err)
	}
	if executablePath, err := db.ResolveOptionalDriverAgentExecutablePath(driverRoot, "sqlserver"); err == nil {
		if _, statErr := os.Stat(executablePath); !os.IsNotExist(statErr) {
			t.Fatalf("canceled download activated a driver binary, stat err=%v", statErr)
		}
	}
}
