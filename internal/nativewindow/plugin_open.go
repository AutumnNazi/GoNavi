package nativewindow

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/plugin"
)

// Open starts one child per running plugin generation. The native child boot is
// asynchronous; a missing event-loop heartbeat causes bounded termination.
func (c *PluginController) Open(ctx context.Context, id string) (PluginWindowInfo, error) {
	if err := ctx.Err(); err != nil {
		return PluginWindowInfo{}, err
	}
	c.mu.Lock()
	admission := c.admissionEpochs[id]
	c.mu.Unlock()
	status, err := c.runningStatus(id, 0)
	if err != nil {
		return PluginWindowInfo{}, err
	}
	c.mu.Lock()
	c.knownGenerations[id] = pluginStatusStamp(status)
	c.mu.Unlock()
	if status.Manifest.Window == nil {
		return PluginWindowInfo{}, errors.New("plugin has no native window")
	}
	entryPath := status.Manifest.Window.Entry
	if !validPluginAssetName(entryPath) || !strings.EqualFold(filepath.Ext(entryPath), ".html") {
		return PluginWindowInfo{}, errors.New("plugin window entry must be a package HTML file")
	}
	if _, err := c.manager.AssetPath(id, entryPath); err != nil {
		return PluginWindowInfo{}, err
	}
	token, err := newBridgeToken()
	if err != nil {
		return PluginWindowInfo{}, err
	}
	windowID, err := newBridgeToken()
	if err != nil {
		return PluginWindowInfo{}, err
	}
	profile, err := os.MkdirTemp("", "gonavi-plugin-window-")
	if err != nil {
		return PluginWindowInfo{}, fmt.Errorf("create plugin webview profile: %w", err)
	}
	if err := preparePluginProfile(profile); err != nil {
		removePluginProfile(profile)
		return PluginWindowInfo{}, err
	}
	entry, existing, err := c.register(status, windowID, token, profile, admission)
	if err != nil || existing.ID != "" {
		removePluginProfile(profile)
		return existing, err
	}
	process, err := c.startProcess(c.processSpec(entry, status))
	if err != nil {
		c.finish(entry)
		c.wg.Done()
		return PluginWindowInfo{}, fmt.Errorf("start plugin window: %w", err)
	}
	c.mu.Lock()
	entry.process = process
	entry.info.PID = process.PID()
	info := entry.info
	c.mu.Unlock()
	go c.supervise(entry, process)
	if ctx.Err() != nil {
		c.revokeEntry(entry)
		return PluginWindowInfo{}, ctx.Err()
	}
	return info, nil
}

func (c *PluginController) register(status plugin.Status, id, token, profile string, admission uint64) (*pluginWindowEntry, PluginWindowInfo, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.life == nil || c.life.Err() != nil {
		return nil, PluginWindowInfo{}, errors.New("plugin window controller is not running")
	}
	if admission != c.admissionEpochs[status.Manifest.ID] {
		return nil, PluginWindowInfo{}, errors.New("plugin window admission was revoked")
	}
	if revoked, exists := c.revokedGenerations[status.Manifest.ID]; exists && pluginStatusStamp(status) == revoked {
		return nil, PluginWindowInfo{}, errors.New("plugin window generation was revoked")
	}
	for _, existing := range c.windows {
		if existing.info.PluginID != status.Manifest.ID {
			continue
		}
		if existing.closing || existing.stamp != pluginStatusStamp(status) {
			return nil, PluginWindowInfo{}, errors.New("plugin window is closing")
		}
		return nil, existing.info, nil
	}
	if len(c.windows) >= pluginMaxWindows {
		return nil, PluginWindowInfo{}, errors.New("plugin window limit reached")
	}
	life, cancel := context.WithCancel(c.life)
	title := status.Manifest.Window.Title
	if title == "" {
		title = status.Manifest.Name
	}
	entry := &pluginWindowEntry{info: PluginWindowInfo{ID: id, PluginID: status.Manifest.ID, Generation: status.Generation},
		stamp: pluginStatusStamp(status), title: title, entry: status.Manifest.Window.Entry, token: token, profile: profile, life: life, cancel: cancel,
		stop: make(chan struct{}), done: make(chan struct{}), opened: time.Now(), requests: make(map[string]context.CancelFunc), canceledRequests: make(map[string]time.Time)}
	c.windows[id] = entry
	// Registration before spawn prevents Close racing a late WaitGroup.Add.
	c.wg.Add(1)
	return entry, PluginWindowInfo{}, nil
}

func (c *PluginController) runningStatus(id string, generation uint64) (plugin.Status, error) {
	for _, status := range c.manager.List() {
		if status.Manifest.ID != id {
			continue
		}
		if !status.DesiredEnabled || status.State != "running" || (generation != 0 && status.Generation != generation) {
			return plugin.Status{}, errors.New("plugin window generation is no longer active")
		}
		return status, nil
	}
	return plugin.Status{}, errors.New("plugin is not installed")
}

func (c *PluginController) monitor(ctx context.Context) {
	defer c.wg.Done()
	ticker := time.NewTicker(c.checkInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			c.revokeAll()
			if err := c.server.Close(); err != nil && !errors.Is(err, context.Canceled) {
				logger.Error(err, "close plugin window bridge")
			}
			return
		case now := <-ticker.C:
			c.mu.Lock()
			entries := make([]*pluginWindowEntry, 0, len(c.windows))
			for _, entry := range c.windows {
				if !entry.closing {
					entries = append(entries, entry)
				}
			}
			c.mu.Unlock()
			for _, entry := range entries {
				c.checkHealth(entry, now)
			}
		}
	}
}

func (c *PluginController) checkHealth(entry *pluginWindowEntry, now time.Time) {
	_, err := c.entryStatus(entry)
	c.mu.Lock()
	defer c.mu.Unlock()
	expired := entry.heartbeat.IsZero() && now.Sub(entry.opened) > c.startupTimeout
	if !entry.heartbeat.IsZero() {
		expired = now.Sub(entry.heartbeat) > c.heartbeatTimeout
	}
	if err != nil || expired {
		c.revokeLocked(entry)
	}
}

func (c *PluginController) supervise(entry *pluginWindowEntry, process pluginProcess) {
	defer c.wg.Done()
	// Wait must run concurrently with the bounded stop timer, and is always joined.
	waited := make(chan struct{})
	go func() {
		if err := process.Wait(); err != nil {
			logger.Error(err, "plugin window process exited: %s", entry.info.PluginID)
		}
		close(waited)
	}()
	select {
	case <-waited:
	case <-entry.stop:
		c.mu.Lock()
		remaining := time.Until(entry.revokedAt.Add(c.stopTimeout))
		c.mu.Unlock()
		timer := time.NewTimer(remaining)
		select {
		case <-waited:
			timer.Stop()
		case <-timer.C:
			if err := process.Kill(); err != nil {
				logger.Error(err, "kill plugin window process tree: %s", entry.info.PluginID)
			}
			<-waited
		}
	}
	c.finish(entry)
}

func (c *PluginController) finish(entry *pluginWindowEntry) {
	c.mu.Lock()
	c.revokeLocked(entry)
	delete(c.windows, entry.info.ID)
	close(entry.done)
	c.mu.Unlock()
	removePluginProfile(entry.profile)
}

func removePluginProfile(profile string) {
	// Only controller-created absolute temporary directories can be removed.
	if !filepath.IsAbs(profile) || !strings.HasPrefix(filepath.Base(profile), "gonavi-plugin-window-") {
		return
	}
	if err := os.RemoveAll(profile); err != nil {
		logger.Error(err, "remove isolated plugin window profile")
	}
}
