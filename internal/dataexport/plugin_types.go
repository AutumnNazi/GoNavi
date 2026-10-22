package dataexport

import "errors"

const (
	pluginExportMaxBytes  = 512 << 10
	pluginExportCellBytes = 128 << 10
	pluginExportMaxNodes  = 131072
	pluginExportMaxDepth  = 32
)

// PluginExportSelection freezes expected package authority, not client permission.
type PluginExportSelection struct {
	Digest     string `json:"digest"`
	Generation uint64 `json:"generation"`
}

// PluginExportCell distinguishes missing/null and preserves explicit string-valued data.
type PluginExportCell struct {
	Kind  string  `json:"kind"`
	Value *string `json:"value,omitempty"`
}

// PluginExportSnapshot owns only the ordered selected columns and their frozen cells.
type PluginExportSnapshot struct {
	Columns []string             `json:"columns"`
	Rows    [][]PluginExportCell `json:"rows"`
}

// ErrPluginExportSnapshot rejects malformed, unsupported or oversized snapshot data.
var ErrPluginExportSnapshot = errors.New("plugin export snapshot rejected")

// ErrPluginExportSelection rejects noncanonical format identities and invalid pins.
var ErrPluginExportSelection = errors.New("plugin exporter selection rejected")

// ErrPluginExporterUnavailable rejects unavailable or revoked execution authority.
var ErrPluginExporterUnavailable = errors.New("plugin exporter unavailable")

// ErrPluginExportRender hides plugin diagnostics and never authorizes an automatic retry.
var ErrPluginExportRender = errors.New("plugin export render failed")
