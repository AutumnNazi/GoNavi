package app

import (
	"sort"
	"strings"

	"GoNavi-Wails/internal/plugin"
)

const maxPluginSkillGeneration uint64 = 1<<53 - 1

// PluginSkillView exposes packaged metadata without loading the skill document.
type PluginSkillView struct {
	PluginID    string   `json:"pluginId"`
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Entry       string   `json:"entry"`
	Resources   []string `json:"resources,omitempty"`
	Version     string   `json:"version"`
	Digest      string   `json:"digest"`
	Generation  uint64   `json:"generation"`
	Available   bool     `json:"available"`
	Reason      string   `json:"reason,omitempty"`
}

// PluginSkillCatalog is a metadata snapshot whose Items always serializes as an array.
type PluginSkillCatalog struct {
	Items []PluginSkillView `json:"items"`
}

func pluginSkillViews(statuses []plugin.Status, safeMode, owned bool) []PluginSkillView {
	items := make([]PluginSkillView, 0)
	for _, status := range statuses {
		if !pluginSkillPermitted(status.Manifest) || status.Generation > maxPluginSkillGeneration {
			continue
		}
		available, reason := pluginSkillAvailability(status, safeMode, owned)
		for _, skill := range status.Manifest.Contributes.Skills {
			items = append(items, PluginSkillView{
				PluginID: status.Manifest.ID, ID: skill.ID, Name: skill.Name,
				Description: skill.Description, Entry: skill.Entry, Resources: pluginSkillResourcePaths(skill.Resources), Version: status.Manifest.Version,
				Digest: status.Digest, Generation: status.Generation, Available: available, Reason: reason,
			})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].PluginID != items[j].PluginID {
			return items[i].PluginID < items[j].PluginID
		}
		return items[i].ID < items[j].ID
	})
	return items
}

func pluginSkillResourcePaths(resources []string) []string {
	if len(resources) == 0 || len(resources) > 4 {
		return nil
	}
	out := make([]string, len(resources))
	copy(out, resources)
	return out
}

func pluginSkillPermitted(manifest plugin.Manifest) bool {
	for _, permission := range manifest.Permissions {
		if permission == "ai.skills" {
			return true
		}
	}
	return false
}

func pluginSkillAvailability(status plugin.Status, safeMode, owned bool) (bool, string) {
	if safeMode {
		return false, "safe_mode"
	}
	if !status.DesiredEnabled {
		return false, "disabled"
	}
	switch status.State {
	case plugin.StateStarting:
		return false, "starting"
	case plugin.StateStopping:
		return false, "stopping"
	case plugin.StateFaulted:
		return false, "faulted"
	case plugin.StateBlocked:
		return false, "blocked"
	case plugin.StateRunning:
		if owned && status.Generation != 0 {
			return true, ""
		}
	}
	return false, "runtime_unavailable"
}

func validPluginSkillRequest(pluginID, skillID, digest string, generation uint64) bool {
	if generation == 0 || generation > maxPluginSkillGeneration || len(digest) != 64 || strings.Trim(digest, "0123456789abcdef") != "" {
		return false
	}
	if !pluginSkillIdentifier(skillID, 64, "_.-") || len(pluginID) > 128 {
		return false
	}
	publisher, name, found := strings.Cut(pluginID, ".")
	if !found || !pluginSkillIdentifier(publisher, 128, "-") || !pluginSkillIdentifier(name, 128, ".-") {
		return false
	}
	for _, part := range strings.Split(pluginID, ".") {
		if part == "" || strings.HasPrefix(part, "-") || strings.HasSuffix(part, "-") {
			return false
		}
	}
	return true
}

func pluginSkillIdentifier(value string, limit int, punctuation string) bool {
	return len(value) > 0 && len(value) <= limit && value[0] >= 'a' && value[0] <= 'z' &&
		strings.Trim(value, "abcdefghijklmnopqrstuvwxyz0123456789"+punctuation) == ""
}
