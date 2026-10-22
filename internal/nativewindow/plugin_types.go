package nativewindow

import (
	"context"
	"encoding/json"
	"io/fs"
	"time"

	"GoNavi-Wails/internal/plugin"
)

// PluginWindowArgument selects the isolated plugin UI child before App startup.
const PluginWindowArgument = "--plugin-window"

const (
	pluginBridgePrefix      = "/__gonavi/plugin-window/"
	pluginAssetPrefix       = "/plugin-assets/"
	pluginTokenHeader       = "X-GoNavi-Plugin-Token"
	pluginWindowHeader      = "X-GoNavi-Plugin-Window"
	pluginMaxJSONBytes      = 1 << 20
	pluginMaxAssetBytes     = 8 << 20
	pluginMaxHTMLBytes      = 2 << 20
	pluginMaxCalls          = 8
	pluginMaxWindows        = 16
	pluginHeartbeatInterval = time.Second
	pluginHeartbeatTimeout  = 3 * time.Second
	pluginStartupTimeout    = 10 * time.Second
	pluginStopTimeout       = 2 * time.Second
)

// PluginControllerOptions supplies only the standalone bridge bundle, not the
// host frontend. Assets must contain runtime.js at its root.
type PluginControllerOptions struct {
	Assets     fs.FS
	Executable string
}

// PluginWindowInfo identifies a host-owned child; it carries no bridge secret.
type PluginWindowInfo struct {
	ID         string `json:"id"`
	PluginID   string `json:"pluginId"`
	Generation uint64 `json:"generation"`
	PID        int    `json:"pid"`
}

type pluginWindowRuntime interface {
	List() []plugin.Status
	AssetPath(id, relative string) (string, error)
	InvokeGeneration(ctx context.Context, id string, generation uint64, command string, args json.RawMessage) (json.RawMessage, error)
}

type pluginProcessSpec struct {
	executable string
	args       []string
	env        []string
	directory  string
}

type pluginProcess interface {
	PID() int
	Wait() error
	Kill() error
}

type pluginBootstrap struct {
	PluginID   string `json:"pluginId"`
	Generation uint64 `json:"generation"`
	Title      string `json:"title"`
}

type pluginInvokeRequest struct {
	ID        string          `json:"id"`
	Command   string          `json:"command"`
	Arguments json.RawMessage `json:"arguments"`
}
