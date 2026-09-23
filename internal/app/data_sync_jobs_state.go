package app

import (
	"errors"
	"sync"

	"GoNavi-Wails/internal/syncjob"
)

// dataSyncJobsState gates worker startup while a data-root move or shutdown drains
// active operations. The mutex protects state only; process/HTTP waits run outside it.
type dataSyncJobsState struct {
	dataSyncJobsMu         sync.Mutex
	dataSyncJobStore       *syncjob.Store
	dataSyncJobManager     *syncjob.Manager
	dataSyncJobsDraining   bool
	dataSyncJobsSuspended  bool
	dataSyncJobsOperations sync.WaitGroup
}

func (a *App) beginDataSyncJobsOperation() error {
	a.dataSyncJobsMu.Lock()
	defer a.dataSyncJobsMu.Unlock()
	if a.dataSyncJobsDraining || a.dataSyncJobsSuspended {
		return errors.New(a.appText("data_sync.worker.maintenance", nil))
	}
	a.dataSyncJobsOperations.Add(1)
	return nil
}
