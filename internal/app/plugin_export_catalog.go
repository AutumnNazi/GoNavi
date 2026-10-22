package app

import (
	"encoding/json"
	"sort"

	"GoNavi-Wails/internal/plugin"
)

func pluginExporterCatalog(statuses []plugin.Status, owned, safe bool) PluginExporterCatalog {
	candidates := make([]PluginExporterView, 0)
	for _, status := range statuses {
		if status.Manifest.Backend == nil || status.Generation > 1<<53-1 {
			continue
		}
		permitted := false
		for _, permission := range status.Manifest.Permissions {
			if permission == "data.export" {
				permitted = true
				break
			}
		}
		if !permitted {
			continue
		}
		reason := pluginExporterUnavailableReason(status, owned, safe)
		for _, decl := range status.Manifest.Contributes.Exporters {
			format := plugin.ExporterType(status.Manifest.ID, decl)
			if format == "" {
				continue
			}
			candidates = append(candidates, PluginExporterView{Format: format, PluginID: status.Manifest.ID, ID: decl.ID, Name: decl.Name, Extension: decl.Extension, ContentType: decl.ContentType, Streaming: decl.Streaming, Version: status.Manifest.Version, Digest: status.Digest, Generation: status.Generation, Available: reason == "", State: status.State, Reason: reason})
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].Format < candidates[j].Format })
	result := PluginExporterCatalog{Items: make([]PluginExporterView, 0)}
	for _, item := range candidates {
		if len(result.Items) == 256 {
			result.Truncated = true
			break
		}
		result.Items = append(result.Items, item)
		result.Truncated = true // Reserve the marker while enforcing the metadata cap.
		encoded, err := json.Marshal(result)
		if err != nil || len(encoded) > 256<<10 {
			result.Items = result.Items[:len(result.Items)-1]
			break
		}
		result.Truncated = false
	}
	return result
}

func pluginExporterUnavailableReason(status plugin.Status, owned, safe bool) string {
	if safe {
		return "safe_mode"
	}
	if !status.DesiredEnabled {
		return "disabled"
	}
	switch status.State {
	case plugin.StateStarting:
		return "starting"
	case plugin.StateStopping:
		return "stopping"
	case plugin.StateFaulted:
		return "faulted"
	case plugin.StateBlocked:
		return "blocked"
	case plugin.StateRunning:
		if owned && status.Generation != 0 && status.Digest != "" {
			return ""
		}
	}
	return "runtime_unavailable"
}
