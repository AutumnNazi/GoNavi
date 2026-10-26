package cli

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"path/filepath"
	"time"

	"GoNavi-Wails/internal/appdata"
	"GoNavi-Wails/internal/plugin"
)

// pluginRuntime keeps argument parsing independent from process implementation.
// Tests use a fake; normal invocations use the real shared-state manager.
type pluginRuntime interface {
	Start(context.Context) error
	Close(context.Context) error
	List() []plugin.Status
	Inspect(context.Context, string) (plugin.Inspection, error)
	Install(context.Context, plugin.InstallRequest) (plugin.Status, error)
	ReplacePackage(context.Context, plugin.InstallRequest) (plugin.Status, error)
	SetEnabled(context.Context, string, bool) (plugin.Status, error)
	Remove(context.Context, string, bool) error
	Invoke(context.Context, string, string, json.RawMessage) (json.RawMessage, error)
}

type pluginFactory func(plugin.Options) (pluginRuntime, error)

// runPlugin is wired by the root CLI switch; it never creates a database App.
func runPlugin(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	return runPluginWithFactory(ctx, args, stdout, stderr, func(options plugin.Options) (pluginRuntime, error) {
		return plugin.NewManager(options)
	})
}

func runPluginWithFactory(ctx context.Context, args []string, stdout, stderr io.Writer, factory pluginFactory) int {
	if stdout == nil {
		stdout = io.Discard
	}
	if stderr == nil {
		stderr = io.Discard
	}
	options, err := parsePluginOptions(args)
	if err != nil {
		return fail(stderr, ExitUsage, "usage", err)
	}
	if options.help {
		return writePluginUsage(stdout, stderr)
	}
	if ctx == nil {
		return fail(stderr, ExitUsage, "usage", errors.New("plugin command requires a lifecycle context"))
	}
	if err := ctx.Err(); err != nil {
		return failPlugin(stderr, err)
	}
	if options.safeMode && (options.command == "enable" || options.command == "invoke") {
		return fail(stderr, ExitPolicyDenied, "plugin_safe_mode", errors.New("plugin execution is disabled by safe mode"))
	}
	root := options.root
	if root == "" {
		active, resolveErr := appdata.ResolveActiveRoot()
		if resolveErr != nil {
			return failPlugin(stderr, resolveErr)
		}
		root = filepath.Join(active, "plugins")
	}
	manager, err := factory(plugin.Options{Root: root, HostVersion: Version, Disabled: options.safeMode})
	if err != nil {
		return failPlugin(stderr, err)
	}
	result, err := executePluginCommand(ctx, manager, options)
	// Shutdown gets a bounded cleanup window even if the command was cancelled.
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	closeErr := manager.Close(cleanup)
	cancel()
	if err != nil {
		return failPlugin(stderr, err)
	}
	if closeErr != nil {
		return failPlugin(stderr, closeErr)
	}
	return emitOutput(stdout, stderr, result)
}

func failPlugin(stderr io.Writer, err error) int {
	switch {
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return fail(stderr, ExitCancelled, "cancelled", err)
	case errors.Is(err, plugin.ErrDisabled):
		return fail(stderr, ExitPolicyDenied, "plugin_disabled", err)
	case errors.Is(err, plugin.ErrDigestMismatch):
		return fail(stderr, ExitPolicyDenied, "plugin_digest_mismatch", err)
	case errors.Is(err, plugin.ErrLocked):
		return fail(stderr, ExitExecution, "plugin_locked", err)
	case errors.Is(err, plugin.ErrNotFound):
		return fail(stderr, ExitExecution, "plugin_not_found", err)
	case errors.Is(err, plugin.ErrBusy):
		return fail(stderr, ExitExecution, "plugin_busy", err)
	default:
		return fail(stderr, ExitExecution, "plugin_failed", err)
	}
}

func writePluginUsage(stdout, stderr io.Writer) int {
	text := `Usage: gonavi [--data-root PATH] plugin [--root PATH] [--safe-mode] <command>

Commands (command flags precede positional arguments):
  list
  inspect PATH
  check PATH                              Static validation; never executes a package
  install --digest SHA256 --trust PATH    Install exact inspected bytes, initially disabled
  replace --digest SHA256 --trust PATH    Swap an installed plugin and keep its enable intent
  enable ID                              Persist desired enabled state; do not start a CLI owner
  disable ID                             Revoke the instance through shared state
  remove [--purge] ID                     Remove package; retain data unless --purge
  invoke [--args JSON] [--timeout 15s] ID COMMAND

--root and --safe-mode may also follow the command, before positional arguments.
GONAVI_DISABLE_PLUGINS=1 forces safe mode. Listing, inspection, installation, disabling and removal remain available; enable and invoke are refused. --safe-mode=false cannot override that environment switch.
Invoke needs the exclusive local runtime owner. Close the desktop owner first;
there is no cross-process invocation broker. Writes are never retried automatically.
Successful output and all statuses are JSON; errors are JSON on stderr.
`
	if _, err := io.WriteString(stdout, text); err != nil {
		return fail(stderr, ExitExecution, "output_failed", err)
	}
	return ExitSuccess
}
