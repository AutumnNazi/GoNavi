package app

import (
	"context"
	"errors"
	"regexp"
)

var pluginExportJobID = regexp.MustCompile("^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
var errPluginExportJob = errors.New("invalid plugin export job")
var errPluginExportBusy = errors.New("plugin export task is already active or busy")

func (a *App) beginPluginExportTask(parent context.Context, jobID string) (context.Context, func(), error) {
	if a == nil || parent == nil || !pluginExportJobID.MatchString(jobID) {
		return nil, nil, errPluginExportJob
	}
	if err := parent.Err(); err != nil {
		return nil, nil, err
	}
	owner := a.pluginRuntimeOwner()
	if owner == nil || owner.ctx == nil {
		return nil, nil, errPluginExportJob
	}
	if err := owner.ctx.Err(); err != nil {
		return nil, nil, err
	}
	owner.plugins.mu.Lock()
	lifetime := owner.plugins.lifetime
	owner.plugins.mu.Unlock()
	if lifetime != nil && lifetime.Err() != nil {
		return nil, nil, lifetime.Err()
	}
	ctx, cancel := context.WithCancel(parent)
	stopRoot := context.AfterFunc(owner.ctx, cancel)
	stopRuntime := func() bool { return false }
	if lifetime != nil {
		stopRuntime = context.AfterFunc(lifetime, cancel)
	}
	registration := &exportTaskRegistration{cancel: cancel, strict: true}
	owner.exportTaskMu.Lock()
	active := 0
	for _, task := range owner.exportTasks {
		if task.strict {
			active++
		}
	}
	_, duplicate := owner.exportTasks[jobID]
	if duplicate || active >= 4 {
		owner.exportTaskMu.Unlock()
		stopRoot()
		stopRuntime()
		cancel()
		return nil, nil, errPluginExportBusy
	}
	if owner.exportTasks == nil {
		owner.exportTasks = make(map[string]*exportTaskRegistration)
	}
	owner.exportTasks[jobID] = registration
	owner.exportTaskMu.Unlock()
	return ctx, func() { stopRoot(); stopRuntime(); owner.finishExportTask(jobID, registration) }, nil
}
