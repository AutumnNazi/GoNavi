package app

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/syncjob"
	"GoNavi-Wails/internal/uievents"
)

const dataSyncJobShutdownTimeout = 15 * time.Second

func (a *App) dataSyncJobDatabasePath() string {
	root := strings.TrimSpace(a.configDir)
	if root == "" {
		root = resolveAppConfigDir()
	}
	return filepath.Join(root, "data_sync", "sync_jobs.db")
}

func (a *App) initializeDataSyncJobs(ctx context.Context) {
	manager, err := a.ensureDataSyncJobManager()
	if err != nil {
		logger.Warnf("初始化数据同步任务管理器失败：%v", err)
		return
	}
	if err := a.registerExistingDataSyncSchedules(ctx, manager); err != nil {
		logger.Warnf("注册已有定时任务的后台启动失败：%v", err)
	}
}

func (a *App) ensureDataSyncJobManager() (*syncjob.Manager, error) {
	if a == nil {
		return nil, fmt.Errorf("application is unavailable")
	}
	if err := a.beginDataSyncJobsOperation(); err != nil {
		return nil, err
	}
	defer a.dataSyncJobsOperations.Done()
	if err := a.ensureDataSyncWorker(); err != nil {
		return nil, err
	}
	a.dataSyncJobsMu.Lock()
	defer a.dataSyncJobsMu.Unlock()
	if a.dataSyncJobsDraining {
		return nil, fmt.Errorf("data sync job manager is shutting down")
	}
	if a.dataSyncJobManager != nil {
		return a.dataSyncJobManager, nil
	}
	store, err := syncjob.Open(a.dataSyncJobDatabasePath())
	if err != nil {
		return nil, err
	}
	manager, err := syncjob.NewManager(context.Background(), store, appDataSyncJobExecutor{app: a}, syncjob.ManagerOptions{
		LeaseOwner: a.dataSyncJobLeaseOwner,
		Passive:    a.usesDataSyncWorker(),
		Hooks: syncjob.ManagerHooks{
			OnRunEvent: func(event syncjob.RunEvent) {
				uievents.Emit(a.ctx, "sync:run-event", event)
			},
		},
	})
	if err != nil {
		_ = store.Close()
		return nil, err
	}
	a.dataSyncJobStore = store
	a.dataSyncJobManager = manager
	return manager, nil
}

func (a *App) shutdownDataSyncJobs() {
	if a == nil {
		return
	}
	a.dataSyncJobsMu.Lock()
	a.dataSyncJobsSuspended = true
	a.dataSyncJobsMu.Unlock()
	a.dataSyncJobsOperations.Wait()
	a.dataSyncJobsMu.Lock()
	manager := a.dataSyncJobManager
	store := a.dataSyncJobStore
	a.dataSyncJobManager = nil
	a.dataSyncJobStore = nil
	a.dataSyncJobsDraining = manager != nil || store != nil
	a.dataSyncJobsMu.Unlock()

	if manager != nil {
		ctx, cancel := context.WithTimeout(context.Background(), dataSyncJobShutdownTimeout)
		err := manager.Shutdown(ctx)
		cancel()
		if err != nil {
			logger.Warnf("等待数据同步任务停止失败：%v", err)
			a.finishDataSyncJobDrainInBackground(manager, store)
			return
		}
	}
	if store != nil {
		if err := store.Close(); err != nil {
			logger.Warnf("关闭数据同步任务存储失败：%v", err)
		}
	}
	a.dataSyncJobsMu.Lock()
	a.dataSyncJobsDraining = false
	a.dataSyncJobsMu.Unlock()
}

// suspendDataSyncJobs returns an idempotent rollback owned by this suspension.
// A rejected concurrent maintenance request must not reopen another caller's gate.
func (a *App) suspendDataSyncJobs() (func(), error) {
	resume := func() {}
	if a == nil {
		return resume, nil
	}
	a.dataSyncJobsMu.Lock()
	if a.dataSyncJobsDraining || a.dataSyncJobsSuspended {
		a.dataSyncJobsMu.Unlock()
		return resume, fmt.Errorf("data sync job manager is already shutting down")
	}
	a.dataSyncJobsSuspended = true
	a.dataSyncJobsMu.Unlock()
	// Block new requests before waiting, so an in-flight startup cannot race Stop.
	a.dataSyncJobsOperations.Wait()
	a.dataSyncJobsMu.Lock()
	wasActive := a.dataSyncJobManager != nil || a.dataSyncJobStore != nil || a.usesDataSyncWorker()
	a.dataSyncJobsMu.Unlock()
	var resumeOnce sync.Once
	resume = func() { resumeOnce.Do(func() { a.resumeDataSyncJobs(wasActive) }) }
	if err := a.stopDataSyncWorkerForMaintenance(); err != nil {
		return resume, err
	}
	a.dataSyncJobsMu.Lock()
	manager := a.dataSyncJobManager
	store := a.dataSyncJobStore
	a.dataSyncJobManager = nil
	a.dataSyncJobStore = nil
	a.dataSyncJobsDraining = manager != nil || store != nil
	a.dataSyncJobsMu.Unlock()
	if manager != nil {
		ctx, cancel := context.WithTimeout(context.Background(), dataSyncJobShutdownTimeout)
		err := manager.Shutdown(ctx)
		cancel()
		if err != nil {
			a.finishDataSyncJobDrainInBackground(manager, store)
			return resume, err
		}
	}
	var closeErr error
	if store != nil {
		closeErr = store.Close()
	}
	a.dataSyncJobsMu.Lock()
	a.dataSyncJobsDraining = false
	a.dataSyncJobsMu.Unlock()
	// Keep the gate closed until the caller finishes migrating and calls resume.
	return resume, closeErr
}

func (a *App) finishDataSyncJobDrainInBackground(manager *syncjob.Manager, store *syncjob.Store) {
	go func() {
		if manager != nil {
			_ = manager.Shutdown(context.Background())
		}
		if store != nil {
			if err := store.Close(); err != nil {
				logger.Warnf("后台关闭数据同步任务存储失败：%v", err)
			}
		}
		a.dataSyncJobsMu.Lock()
		a.dataSyncJobsDraining = false
		a.dataSyncJobsMu.Unlock()
	}()
}

func (a *App) resumeDataSyncJobs(wasActive bool) {
	a.dataSyncJobsMu.Lock()
	a.dataSyncJobsSuspended = false
	a.dataSyncJobsMu.Unlock()
	if !wasActive {
		return
	}
	a.initializeDataSyncJobs(context.Background())
}
