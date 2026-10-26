package mcpserver

import (
	"context"
	"time"

	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/plugin"
)

const pluginSkillStartupWait = 2 * time.Second

// waitForPluginSkillSnapshot waits only for a runtime that already belongs to
// this process. It neither executes a package nor reads a document. Expiry is
// optional-feature unavailability, not a failure of ordinary Agent discovery.
func waitForPluginSkillSnapshot(ctx context.Context, statuses func() []plugin.Status, owned func() bool, budget time.Duration) ([]plugin.Status, error) {
	if ctx == nil {
		return nil, runharness.ErrRootContextRequired
	}
	if budget < 0 {
		budget = 0
	}
	if budget > pluginSkillStartupWait {
		budget = pluginSkillStartupWait
	}
	timer := time.NewTimer(budget)
	defer timer.Stop()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	var current []plugin.Status
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !owned() {
			return []plugin.Status{}, nil
		}
		current = statuses()
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !pluginSkillsStarting(current) {
			return current, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timer.C:
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			return current, nil
		case <-ticker.C:
		}
	}
}

func pluginSkillsStarting(statuses []plugin.Status) bool {
	for _, status := range statuses {
		if !status.DesiredEnabled || status.State != plugin.StateStarting || len(status.Manifest.Contributes.Skills) == 0 {
			continue
		}
		for _, permission := range status.Manifest.Permissions {
			if permission == "ai.skills" {
				return true
			}
		}
	}
	return false
}
