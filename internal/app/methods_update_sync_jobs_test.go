package app

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestInstallUpdateAndRestartSuspendsSavedTasks(t *testing.T) {
	for _, launchFails := range []bool{false, true} {
		name := "successful handoff keeps scheduler stopped"
		if launchFails {
			name = "failed handoff restores scheduler"
		}
		t.Run(name, func(t *testing.T) {
			application := &App{configDir: t.TempDir()}
			defer application.shutdownDataSyncJobs()
			if _, err := application.ensureDataSyncJobManager(); err != nil {
				t.Fatal(err)
			}
			application.updateState.staged = &stagedUpdate{
				FilePath:    filepath.Join(t.TempDir(), "GoNavi-update.exe"),
				InstallMode: updateInstallModePortable,
				PackageType: updatePackageTypePortable,
			}
			restoreUpdateTestHooks(t, application.configDir)
			exited := make(chan struct{}, 1) // One updater quit completion, awaited before restoring hooks.
			updateQuitSleep = func(time.Duration) {}
			updateExitProcess = func(int) { exited <- struct{}{} }
			launched := false
			updateLaunchInstallScript = func(*stagedUpdate) error {
				launched = true
				if application.dataSyncJobManager != nil || application.dataSyncJobStore != nil {
					t.Error("installer started before task resources were released")
				}
				if _, err := application.ensureDataSyncJobManager(); err == nil {
					t.Error("task polling reopened the scheduler before installer handoff")
				}
				if launchFails {
					return errors.New("installer unavailable")
				}
				return nil
			}
			result := application.InstallUpdateAndRestart(true)
			if !launched || result.Success == launchFails {
				t.Fatalf("launched=%v result=%+v", launched, result)
			}
			if launchFails {
				if application.dataSyncJobManager == nil {
					t.Fatal("failed installation left scheduler stopped")
				}
				if _, err := application.dataSyncJobManager.ListJobs(context.Background()); err != nil {
					t.Fatal(err)
				}
				return
			}
			select {
			case <-exited:
			case <-time.After(time.Second):
				t.Fatal("installer quit did not complete")
			}
			if _, err := application.ensureDataSyncJobManager(); err == nil {
				t.Fatal("scheduler resumed after installer handoff")
			}
		})
	}
}

func TestInstallUpdateAndRestartDoesNotReleaseExistingMaintenance(t *testing.T) {
	application := &App{configDir: t.TempDir()}
	defer application.shutdownDataSyncJobs()
	resume, err := application.suspendDataSyncJobs()
	if err != nil {
		t.Fatal(err)
	}
	defer resume()
	application.updateState.staged = &stagedUpdate{
		FilePath:    filepath.Join(t.TempDir(), "GoNavi-update.exe"),
		InstallMode: updateInstallModePortable,
		PackageType: updatePackageTypePortable,
	}
	restoreUpdateTestHooks(t, application.configDir)
	updateLaunchInstallScript = func(*stagedUpdate) error { t.Fatal("installer started during migration"); return nil }
	if result := application.InstallUpdateAndRestart(true); result.Success {
		t.Fatal("update accepted during migration")
	}
	if _, err := application.ensureDataSyncJobManager(); err == nil {
		t.Fatal("rejected update released the migration gate")
	}
}

func restoreUpdateTestHooks(t *testing.T, root string) {
	t.Helper()
	resolve, acquire, find := updateResolveInstallTarget, updateAcquireWindowsMaintenance, updateFindOtherWindowsInstances
	launch, sleep, exit := updateLaunchInstallScript, updateQuitSleep, updateExitProcess
	t.Cleanup(func() {
		updateResolveInstallTarget, updateAcquireWindowsMaintenance, updateFindOtherWindowsInstances = resolve, acquire, find
		updateLaunchInstallScript, updateQuitSleep, updateExitProcess = launch, sleep, exit
	})
	updateResolveInstallTarget = func() string { return filepath.Join(root, "GoNavi.exe") }
	updateAcquireWindowsMaintenance = func(string) (windowsUpdateMaintenanceLease, error) { return windowsUpdateMaintenanceLease{}, nil }
	updateFindOtherWindowsInstances = func([]string, int) ([]windowsUpdateProcess, error) { return nil, nil }
}
