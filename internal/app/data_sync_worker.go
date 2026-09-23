package app

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"GoNavi-Wails/internal/appdata"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/syncjob"
	"GoNavi-Wails/internal/syncworker"
)

// RunSyncWorker starts only the backend task runtime; no Wails window is created.
func RunSyncWorker(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("sync-worker", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	dataRoot := flags.String("data-root", "", "GoNavi data directory")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("sync-worker accepts only --data-root")
	}
	root, err := appdata.ResolveActiveRoot()
	if strings.TrimSpace(*dataRoot) != "" {
		root, err = appdata.ResolveRoot(*dataRoot)
	}
	if err != nil {
		return err
	}
	return syncworker.Run(ctx, root, func(workerCtx context.Context) (func(), error) {
		application, err := NewHeadlessApp(workerCtx, root)
		if err != nil {
			return nil, err
		}
		manager, err := application.ensureDataSyncJobManager()
		if err != nil {
			application.Shutdown()
			return nil, err
		}
		return func() {
			// Keep the process lock until every executor has released its resources.
			if err := manager.Shutdown(context.Background()); err != nil {
				logger.Warnf("关闭后台调度失败：%v", err)
			}
			application.Shutdown()
		}, nil
	})
}

func (a *App) usesDataSyncWorker() bool {
	if a == nil || a.ctx == nil || a.headlessRuntime || a.webRuntime {
		return false
	}
	// Test binaries do not implement the main executable's special-mode entry.
	return !strings.HasSuffix(strings.TrimSuffix(strings.ToLower(os.Args[0]), ".exe"), ".test")
}

func (a *App) ensureDataSyncWorker() error {
	if !a.usesDataSyncWorker() {
		return nil
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := syncworker.Ensure(ctx, a.configDir, executable); err != nil {
		return fmt.Errorf("%s: %w", a.appText("data_sync.worker.start_failed", nil), err)
	}
	return nil
}

func (a *App) prepareDataSyncSchedule(definition syncjob.JobDefinition) error {
	if err := a.beginDataSyncJobsOperation(); err != nil {
		return err
	}
	defer a.dataSyncJobsOperations.Done()
	if !a.usesDataSyncWorker() || definition.Lifecycle != syncjob.JobLifecycleEnabled || definition.Schedule.Kind == syncjob.ScheduleManual {
		return nil
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := syncworker.Register(ctx, a.configDir, executable); err != nil {
		return fmt.Errorf("%s: %w", a.appText("data_sync.worker.registration_failed", nil), err)
	}
	return nil
}

func (a *App) stopDataSyncWorkerForMaintenance() error {
	if !a.usesDataSyncWorker() {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), dataSyncJobShutdownTimeout+5*time.Second)
	defer cancel()
	if err := syncworker.Stop(ctx, a.configDir); err != nil {
		return err
	}
	return syncworker.Unregister(ctx, a.configDir)
}

func (a *App) registerExistingDataSyncSchedules(ctx context.Context, manager *syncjob.Manager) error {
	if !a.usesDataSyncWorker() {
		return nil
	}
	jobs, err := manager.ListJobs(ctx)
	if err != nil {
		return err
	}
	for _, job := range jobs {
		if job.Lifecycle == syncjob.JobLifecycleEnabled && job.Schedule.Kind != syncjob.ScheduleManual {
			return a.prepareDataSyncSchedule(job)
		}
	}
	return nil
}
