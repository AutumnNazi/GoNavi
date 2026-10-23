package dataexport

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"GoNavi-Wails/internal/plugin"
)

// PluginExporter binds one existing owned generation and never owns a destination or runtime.
type PluginExporter struct {
	manager    *plugin.Manager
	pluginID   string
	pin        PluginExportSelection
	version    string
	descriptor plugin.Exporter
	invoke     func(context.Context, json.RawMessage) (json.RawMessage, error)
}

// NewPluginExporter checks an exact declared format/pin without enabling or starting code.
func NewPluginExporter(ctx context.Context, manager *plugin.Manager, format string, pin PluginExportSelection) (*PluginExporter, error) {
	if ctx == nil {
		return nil, ErrPluginExporterUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	id, exporterID, ok := plugin.ParseExporterType(format)
	if !ok || len(pin.Digest) != 64 || strings.Trim(pin.Digest, "0123456789abcdef") != "" || pin.Generation == 0 || pin.Generation > 1<<53-1 {
		return nil, ErrPluginExportSelection
	}
	if manager == nil || !manager.OwnsRuntime() {
		return nil, ErrPluginExporterUnavailable
	}
	for _, status := range manager.List() {
		if status.Manifest.ID != id || status.Digest != pin.Digest || status.Generation != pin.Generation {
			continue
		}
		for _, declaration := range status.Manifest.Contributes.Exporters {
			if declaration.ID != exporterID {
				continue
			}
			exporter := &PluginExporter{manager: manager, pluginID: id, pin: pin, version: status.Manifest.Version, descriptor: declaration}
			exporter.invoke = func(ctx context.Context, args json.RawMessage) (json.RawMessage, error) {
				return manager.InvokeExporterGeneration(ctx, id, pin.Generation, exporterID, pin.Digest, args)
			}
			if err := exporter.Check(ctx); err != nil {
				return nil, err
			}
			return exporter, nil
		}
	}
	return nil, ErrPluginExporterUnavailable
}

// Descriptor returns immutable package metadata, not a path or plugin-controlled filename.
func (e *PluginExporter) Descriptor() plugin.Exporter { return e.descriptor }

// Check revalidates the same owner, generation, digest, permission and dependencies without RPC.
func (e *PluginExporter) Check(ctx context.Context) error {
	if ctx == nil {
		return ErrPluginExporterUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if e == nil || e.manager == nil {
		return ErrPluginExporterUnavailable
	}
	if err := e.manager.CheckExporterGeneration(ctx, e.pluginID, e.pin.Generation, e.descriptor.ID, e.pin.Digest); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return ErrPluginExporterUnavailable
	}
	for _, status := range e.manager.List() {
		if status.Manifest.ID != e.pluginID || status.Manifest.Version != e.version || status.Generation != e.pin.Generation || status.Digest != e.pin.Digest {
			continue
		}
		for _, declaration := range status.Manifest.Contributes.Exporters {
			if declaration == e.descriptor {
				return ctx.Err()
			}
		}
	}
	return ErrPluginExporterUnavailable
}

type pluginExportRequest struct {
	ProtocolVersion int                  `json:"protocolVersion"`
	ExporterID      string               `json:"exporterId"`
	Columns         []string             `json:"columns"`
	Rows            [][]PluginExportCell `json:"rows"`
}

// Render sends one bounded frozen snapshot and returns validated text only, without replay.
func (e *PluginExporter) Render(ctx context.Context, snapshot PluginExportSnapshot) ([]byte, error) {
	if err := e.Check(ctx); err != nil {
		return nil, err
	}
	request, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	frozen, err := pluginExportSnapshotCopy(request, snapshot)
	if err != nil {
		return nil, err
	}
	args, err := json.Marshal(pluginExportRequest{ProtocolVersion: 1, ExporterID: e.descriptor.ID, Columns: frozen.Columns, Rows: frozen.Rows})
	if err != nil {
		return nil, ErrPluginExportSnapshot
	}
	budget := pluginExportBudget{ctx: request}
	if err = pluginExportCheckJSON(args, pluginExportMaxBytes, &budget, 0); err != nil {
		return nil, err
	}
	if err = e.Check(request); err != nil {
		return nil, err
	}
	reply, err := e.invoke(request, args)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, ErrPluginExportRender
	}
	if err = e.Check(request); err != nil {
		return nil, err
	}
	text, err := pluginExportReply(request, reply, len(frozen.Rows))
	if err != nil {
		return nil, err
	}
	if err = e.Check(request); err != nil {
		return nil, err
	}
	return []byte(text), nil
}
func pluginExportReply(ctx context.Context, raw []byte, rows int) (string, error) {
	budget := pluginExportBudget{ctx: ctx, textLimit: pluginExportMaxBytes}
	if pluginExportCheckJSON(raw, pluginExportMaxBytes, &budget, 0) != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", ErrPluginExportRender
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || len(fields) != 3 {
		return "", ErrPluginExportRender
	}
	for _, key := range []string{"protocolVersion", "rowCount", "text"} {
		value, ok := fields[key]
		if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return "", ErrPluginExportRender
		}
	}
	var result struct {
		ProtocolVersion int    `json:"protocolVersion"`
		RowCount        int    `json:"rowCount"`
		Text            string `json:"text"`
	}
	if json.Unmarshal(raw, &result) != nil || result.ProtocolVersion != 1 || result.RowCount != rows || !utf8.ValidString(result.Text) || len(result.Text) > pluginExportMaxBytes || strings.ContainsRune(result.Text, 0) || (rows > 0 && result.Text == "") {
		return "", ErrPluginExportRender
	}
	return result.Text, nil
}
