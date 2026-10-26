package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"GoNavi-Wails/internal/plugin"
)

func executePluginCommand(ctx context.Context, manager pluginRuntime, options pluginOptions) (any, error) {
	switch options.command {
	case "list":
		return manager.List(), nil
	case "inspect":
		inspection, err := manager.Inspect(ctx, options.positional[0])
		return inspection, publicPluginPackageError(err, options.positional[0])
	case "check":
		inspection, err := manager.Inspect(ctx, options.positional[0])
		if err != nil {
			return nil, publicPluginPackageError(err, options.positional[0])
		}
		return struct {
			Valid      bool              `json:"valid"`
			Inspection plugin.Inspection `json:"inspection"`
		}{Valid: true, Inspection: inspection}, nil
	case "install":
		status, err := manager.Install(ctx, plugin.InstallRequest{Path: options.positional[0], Digest: options.digest, Trusted: options.trusted})
		return status, publicPluginPackageError(err, options.positional[0])
	case "replace":
		status, err := manager.ReplacePackage(ctx, plugin.InstallRequest{Path: options.positional[0], Digest: options.digest, Trusted: options.trusted})
		return status, publicPluginPackageError(err, options.positional[0])
	case "enable", "disable":
		return manager.SetEnabled(ctx, options.positional[0], options.command == "enable")
	case "remove":
		if err := manager.Remove(ctx, options.positional[0], options.purge); err != nil {
			return nil, err
		}
		return struct {
			Removed bool `json:"removed"`
		}{Removed: true}, nil
	case "invoke":
		return invokePluginCommand(ctx, manager, options)
	default:
		return nil, fmt.Errorf("unknown plugin command %q", options.command)
	}
}

// sanitizedPluginError exposes redacted text while keeping the original error reachable, so the
// caller can still map sentinels such as ErrDisabled or ErrDigestMismatch to an exit code.
type sanitizedPluginError struct {
	message string
	cause   error
}

func (e sanitizedPluginError) Error() string { return e.message }
func (e sanitizedPluginError) Unwrap() error { return e.cause }

func publicPluginPackageError(err error, supplied string) error {
	if err == nil {
		return nil
	}
	text := err.Error()
	if supplied != "" {
		text = strings.ReplaceAll(text, supplied, "package")
	}
	if absolute, absErr := filepath.Abs(supplied); absErr == nil {
		text = strings.ReplaceAll(text, absolute, "package")
	}
	return sanitizedPluginError{message: text, cause: err}
}

func invokePluginCommand(ctx context.Context, manager pluginRuntime, options pluginOptions) (json.RawMessage, error) {
	request, cancel := context.WithTimeout(ctx, options.timeout)
	defer cancel()
	id := options.positional[0]
	status, err := findPluginStatus(manager.List(), id)
	if err != nil {
		return nil, err
	}
	// Invocation never silently enables a package or clears crash quarantine.
	if !status.DesiredEnabled {
		return nil, plugin.ErrDisabled
	}
	if err := manager.Start(request); err != nil {
		return nil, fmt.Errorf("start CLI plugin owner (close an existing desktop owner first): %w", err)
	}
	if err := waitPluginRunning(request, manager, id); err != nil {
		return nil, err
	}
	return manager.Invoke(request, id, options.positional[1], json.RawMessage(options.arguments))
}

func waitPluginRunning(ctx context.Context, manager pluginRuntime, id string) error {
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		status, err := findPluginStatus(manager.List(), id)
		if err != nil {
			return err
		}
		if !status.DesiredEnabled {
			return plugin.ErrDisabled
		}
		switch status.State {
		case plugin.StateRunning:
			return nil
		case plugin.StateFaulted, plugin.StateBlocked:
			return fmt.Errorf("plugin startup %s: %s", status.State, status.LastError)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func findPluginStatus(statuses []plugin.Status, id string) (plugin.Status, error) {
	for _, status := range statuses {
		if status.Manifest.ID == id {
			return status, nil
		}
	}
	return plugin.Status{}, plugin.ErrNotFound
}
