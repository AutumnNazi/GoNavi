package app

import (
	"testing"
	"time"
)

func TestDataSyncJobsStaySuspendedUntilRootMigrationFinishes(t *testing.T) {
	for _, active := range []bool{false, true} {
		name := "idle"
		if active {
			name = "active"
		}
		t.Run(name, func(t *testing.T) {
			application := &App{configDir: t.TempDir()}
			defer application.shutdownDataSyncJobs()
			if active {
				if _, err := application.ensureDataSyncJobManager(); err != nil {
					t.Fatal(err)
				}
			}
			resume, err := application.suspendDataSyncJobs()
			if err != nil {
				t.Fatal(err)
			}
			if _, err := application.ensureDataSyncJobManager(); err == nil {
				t.Fatal("UI polling must not reopen the task store during migration")
			}
			application.configDir = t.TempDir()
			resume()
			if restored := application.dataSyncJobManager != nil; restored != active {
				t.Fatalf("restored manager = %v, want %v", restored, active)
			}
			if _, err := application.ensureDataSyncJobManager(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDataSyncJobsSuspensionWaitsForWorkerStartup(t *testing.T) {
	application := &App{configDir: t.TempDir()}
	defer application.shutdownDataSyncJobs()
	if err := application.beginDataSyncJobsOperation(); err != nil {
		t.Fatal(err)
	}
	// Simulate a worker startup already outside the mutex performing process IO.
	result := make(chan error, 1) // Allow cleanup to finish even if an assertion fails.
	go func() { _, err := application.suspendDataSyncJobs(); result <- err }()
	deadline := time.NewTimer(time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for {
		application.dataSyncJobsMu.Lock()
		suspended := application.dataSyncJobsSuspended
		application.dataSyncJobsMu.Unlock()
		if suspended {
			break
		}
		select {
		case <-deadline.C:
			application.dataSyncJobsOperations.Done()
			t.Fatal("maintenance did not close the operation gate")
		case <-ticker.C:
		}
	}
	if err := application.beginDataSyncJobsOperation(); err == nil {
		application.dataSyncJobsOperations.Done()
		application.dataSyncJobsOperations.Done()
		t.Fatal("new worker startup was accepted during maintenance")
	}
	select {
	case err := <-result:
		application.dataSyncJobsOperations.Done()
		t.Fatalf("maintenance returned before worker startup completed: %v", err)
	default:
	}
	application.dataSyncJobsOperations.Done()
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-deadline.C:
		t.Fatal("maintenance did not finish after worker startup completed")
	}
	application.resumeDataSyncJobs(false)
}

func TestDataSyncJobsRejectedMaintenanceCannotResumeAnotherSuspension(t *testing.T) {
	application := &App{configDir: t.TempDir()}
	defer application.shutdownDataSyncJobs()
	resume, err := application.suspendDataSyncJobs()
	if err != nil {
		t.Fatal(err)
	}
	rejectedResume, err := application.suspendDataSyncJobs()
	if err == nil {
		t.Fatal("concurrent maintenance was accepted")
	}
	rejectedResume()
	if _, err := application.ensureDataSyncJobManager(); err == nil {
		t.Fatal("rejected maintenance reopened the active suspension")
	}
	resume()
	nextResume, err := application.suspendDataSyncJobs()
	if err != nil {
		t.Fatal(err)
	}
	resume()
	if _, err := application.ensureDataSyncJobManager(); err == nil {
		t.Fatal("repeated rollback reopened a later suspension")
	}
	nextResume()
}
