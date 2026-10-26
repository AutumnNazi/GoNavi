package app

import (
	"errors"
	"time"

	"GoNavi-Wails/internal/plugin"
)

// suspendPluginsForRootChange prevents copying live executables, state or windows.
// Disable stays independent of the commit lock; new enable/install operations wait.
func (a *App) suspendPluginsForRootChange() (func(), error) {
	a.plugins.mutationMu.Lock()
	state := &a.plugins
	state.mu.Lock()
	if state.closing || state.initializing != nil {
		state.mu.Unlock()
		state.mutationMu.Unlock()
		return nil, errors.New("plugin lifecycle transition is in progress")
	}
	state.closing = true
	manager, windows, cancel := state.manager, state.windows, state.cancel
	state.mu.Unlock()
	if manager != nil {
		for _, status := range manager.List() {
			if status.DesiredEnabled || status.State == plugin.StateStarting || status.State == plugin.StateRunning || status.State == plugin.StateStopping {
				state.mu.Lock()
				if !state.shuttingDown {
					state.closing = false
				}
				state.mu.Unlock()
				state.mutationMu.Unlock()
				return nil, errors.New("disable plugins before changing the data root")
			}
		}
	}
	a.shutdownPluginMarket()
	if cancel != nil {
		cancel()
	}
	clean := closePluginResources(manager, windows)
	a.pluginMarket.mu.Lock()
	marketReady := a.pluginMarket.initializing
	a.pluginMarket.mu.Unlock()
	if marketReady != nil {
		timer := time.NewTimer(5 * time.Second)
		select {
		case <-marketReady:
		case <-timer.C:
			clean = false
		}
		timer.Stop()
	}
	resume := func() {
		state.mu.Lock()
		stopped := state.shuttingDown
		state.manager, state.windows = nil, nil
		state.root = ""
		if !stopped {
			state.closing = false
		}
		state.mu.Unlock()
		if !stopped {
			a.pluginMarket.mu.Lock()
			a.pluginMarket.service = nil
			a.pluginMarket.root = ""
			a.pluginMarket.closing = false
			a.pluginMarket.mu.Unlock()
		}
		state.mutationMu.Unlock()
		if !stopped && a.ctx != nil && manager != nil {
			a.initializePlugins(a.ctx)
		}
	}
	if !clean {
		resume()
		return nil, errors.New("plugin cleanup pending")
	}
	return resume, nil
}
