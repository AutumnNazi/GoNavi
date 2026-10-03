package syncjob

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func backupTestDefinition(directory string) JobDefinition {
	return NormalizeDefinition(JobDefinition{Name: "backup", Kind: JobKindBackup, Lifecycle: JobLifecycleEnabled,
		Source: EndpointRef{ConnectionID: "source"}, Backup: &BackupSpec{Directory: directory, Content: "both"},
		Mappings: []TableMapping{{SourceTable: "orders", Enabled: true}, {SourceTable: "items", Enabled: true}},
		Schedule: ScheduleSpec{Kind: ScheduleCron, CronExpression: "0 2 * * *", Timezone: "UTC"},
	})
}

func TestBackupDefinitionValidationAndRoundTrip(t *testing.T) {
	directory := t.TempDir()
	for _, test := range []struct {
		name   string
		change func(*JobDefinition)
		valid  bool
	}{
		{"no target and multiple tables", func(*JobDefinition) {}, true},
		{"relative path", func(d *JobDefinition) { d.Backup.Directory = "relative" }, false},
		{"missing backup", func(d *JobDefinition) { d.Backup = nil }, false},
		{"unknown format", func(d *JobDefinition) { d.Backup.Content = "binary" }, false},
		{"target forbidden", func(d *JobDefinition) { d.Target.ConnectionID = "target" }, false},
		{"incremental forbidden", func(d *JobDefinition) { d.IncrementalMode = IncrementalWatermark }, false},
		{"invalid cron", func(d *JobDefinition) { d.Schedule.CronExpression = "invalid" }, false},
		{"no tables", func(d *JobDefinition) { d.Mappings = nil }, false},
		{"duplicate table", func(d *JobDefinition) { d.Mappings[1].SourceTable = "orders" }, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			definition := backupTestDefinition(directory)
			test.change(&definition)
			if err := ValidateDefinition(definition); (err == nil) != test.valid {
				t.Fatalf("valid=%v err=%v", test.valid, err)
			}
		})
	}
	file := filepath.Join(t.TempDir(), "jobs.db")
	store, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := store.PutJob(context.Background(), backupTestDefinition(directory))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	loaded, err := reopened.GetJob(context.Background(), saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Backup == nil || loaded.Backup.Directory != directory || loaded.Kind != JobKindBackup || loaded.NextRunAt == 0 {
		t.Fatalf("bad persisted backup: %+v", loaded)
	}
}

func TestPassiveManagerCloseDoesNotStopWorkerRun(t *testing.T) {
	store := openTestStore(t)
	job := putTestJob(t, store, "forbid")
	started := make(chan string, 1) // One run is expected.
	release := make(chan struct{})
	executor := ExecutorFunc(func(ctx context.Context, request ExecutionRequest, _ RunReporter) (ExecutionOutcome, error) {
		started <- request.Run.ID
		select {
		case <-ctx.Done():
			return ExecutionOutcome{}, ctx.Err()
		case <-release:
			return ExecutionOutcome{}, nil
		}
	})
	worker, err := NewManager(context.Background(), store, executor, ManagerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Shutdown(context.Background())
	desktop, err := NewManager(context.Background(), store, ExecutorFunc(func(context.Context, ExecutionRequest, RunReporter) (ExecutionOutcome, error) {
		t.Error("passive desktop must never execute work")
		return ExecutionOutcome{}, nil
	}), ManagerOptions{Passive: true})
	if err != nil {
		t.Fatal(err)
	}
	defer desktop.Shutdown(context.Background())
	run, err := desktop.StartRun(context.Background(), job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if id := receiveString(t, started); id != run.ID {
		t.Fatalf("run %s", id)
	}
	if err := desktop.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	assertRunStatus(t, store, run.ID, RunStatusRunning)
	close(release)
	waitRunStatus(t, store, run.ID, RunStatusSucceeded)
}

func TestPassiveManagerDoesNotAcquireSchedulerLease(t *testing.T) {
	store := openTestStore(t)
	manager, err := NewManager(context.Background(), store, ExecutorFunc(func(context.Context, ExecutionRequest, RunReporter) (ExecutionOutcome, error) {
		return ExecutionOutcome{}, nil
	}), ManagerOptions{Passive: true})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Shutdown(context.Background())
	acquired, err := store.AcquireSchedulerLease(context.Background(), "data-sync-scheduler", "worker", time.Now(), time.Minute)
	if err != nil || !acquired {
		t.Fatalf("worker lease: acquired=%v err=%v", acquired, err)
	}
}

func TestScheduledBackupFiresAfterDesktopCloses(t *testing.T) {
	store := openTestStore(t)
	started := make(chan string, 1) // One scheduled run is expected.
	executor := ExecutorFunc(func(_ context.Context, request ExecutionRequest, _ RunReporter) (ExecutionOutcome, error) {
		started <- request.Run.ID
		return ExecutionOutcome{}, nil
	})
	worker, err := NewManager(context.Background(), store, executor, ManagerOptions{SchedulerInterval: 10 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Shutdown(context.Background())
	desktop, err := NewManager(context.Background(), store, executor, ManagerOptions{Passive: true})
	if err != nil {
		t.Fatal(err)
	}
	defer desktop.Shutdown(context.Background())
	job := backupTestDefinition(t.TempDir())
	job.Schedule = ScheduleSpec{Kind: ScheduleOnce, RunAt: time.Now().Add(250 * time.Millisecond).UnixMilli()}
	saved, err := desktop.PutJob(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	if err := desktop.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	runID := receiveString(t, started)
	run := waitRunStatus(t, store, runID, RunStatusSucceeded)
	if run.JobID != saved.ID || run.Trigger != RunTriggerSchedule {
		t.Fatalf("unexpected scheduled run: %+v", run)
	}
}
