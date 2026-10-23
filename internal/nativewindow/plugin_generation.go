package nativewindow

import (
	"errors"

	"GoNavi-Wails/internal/plugin"
)

type pluginWindowStamp struct {
	generation  uint64
	installedAt string
	digest      string
}

func pluginStatusStamp(status plugin.Status) pluginWindowStamp {
	return pluginWindowStamp{generation: status.Generation, installedAt: status.InstalledAt, digest: status.Digest}
}

func (c *PluginController) entryStatus(entry *pluginWindowEntry) (plugin.Status, error) {
	status, err := c.runningStatus(entry.info.PluginID, entry.info.Generation)
	if err != nil {
		return plugin.Status{}, err
	}
	// Generation plus immutable installation identity also fences remove/reinstall
	// performed by another management process between health polls.
	if pluginStatusStamp(status) != entry.stamp {
		return plugin.Status{}, errors.New("plugin window installation was replaced")
	}
	return status, nil
}
