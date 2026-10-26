package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// ErrExporterCommandReserved rejects ordinary calls to host-managed export commands.
var ErrExporterCommandReserved = errors.New("plugin exporter command requires host-managed invocation")
var errExporterInvocationDeadline = fmt.Errorf("plugin exporter invocation deadline exceeded: %w", context.DeadlineExceeded)

type exporterLease struct {
	instance *instance
	record   record
	exporter Exporter
}

// InvokeExporterGeneration renders through a frozen host-owned binding, without startup or replay.
// It sends no host destination and uses the existing bounded transport and invocation quota.
func (m *Manager) InvokeExporterGeneration(ctx context.Context, id string, generation uint64, exporterID, digest string, args json.RawMessage) (json.RawMessage, error) {
	if ctx == nil {
		return nil, fmt.Errorf("exporter invocation requires context")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := validateExporterArguments(args, exporterID); err != nil {
		return nil, err
	}
	lease, err := m.exporterSnapshot(ctx, id, generation, exporterID, digest)
	if err != nil {
		return nil, err
	}
	if err = m.admitExporter(lease); err != nil {
		return nil, err
	}
	defer func() { m.mu.Lock(); lease.instance.inflight--; m.mu.Unlock() }()
	request, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(lease.instance.ctx, cancel)
	defer stop()
	result, err := lease.instance.process.callBounded(request, "plugin.invoke", struct {
		CommandID string          `json:"commandId"`
		Arguments json.RawMessage `json:"arguments"`
	}{CommandID: lease.exporter.Command, Arguments: args}, rpcCallPolicy{maxResponseBytes: maxExporterJSONBytes + 1024, dispatchTimeout: m.opts.InvocationTimeout, timeoutError: errExporterInvocationDeadline})
	if err != nil {
		return nil, err
	}
	if len(result) > maxExporterJSONBytes {
		return nil, fmt.Errorf("exporter result exceeds size limit")
	}
	current, err := m.exporterSnapshot(request, id, generation, exporterID, digest)
	if err != nil {
		return nil, err
	}
	if current.instance != lease.instance || current.exporter != lease.exporter || current.record.Manifest.Version != lease.record.Manifest.Version {
		return nil, ErrDisabled
	}
	return result, nil
}

// CheckExporterGeneration is a readonly host authority check; it acquires no invocation capacity.
func (m *Manager) CheckExporterGeneration(ctx context.Context, id string, generation uint64, exporterID, digest string) error {
	if ctx == nil {
		return fmt.Errorf("exporter check requires context")
	}
	_, err := m.exporterSnapshot(ctx, id, generation, exporterID, digest)
	return err
}

func (m *Manager) exporterSnapshot(ctx context.Context, id string, generation uint64, exporterID, digest string) (exporterLease, error) {
	var empty exporterLease
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if generation == 0 || m.opts.Disabled || !m.OwnsRuntime() {
		return empty, ErrDisabled
	}
	if !validDigest(digest) {
		return empty, ErrDigestMismatch
	}
	state, err := m.loadState()
	if err != nil {
		return empty, err
	}
	record, ok := state.Records[id]
	if !ok {
		return empty, ErrNotFound
	}
	if !record.DesiredEnabled || record.State != StateRunning || record.Quarantined || record.Removing || record.Generation != generation || dependencyReason(record, state.Records) != "" {
		return empty, ErrDisabled
	}
	if record.Digest != digest {
		return empty, ErrDigestMismatch
	}
	exporter, err := declaredExporter(record.Manifest, exporterID)
	if err != nil {
		return empty, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return empty, ErrClosed
	}
	instance := m.instances[id]
	if !m.started || m.owner == nil || instance == nil || !instance.ready || instance.ctx.Err() != nil || instance.process == nil || instance.record.Generation != generation || instance.record.Digest != digest {
		return empty, ErrDisabled
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return exporterLease{instance: instance, record: record, exporter: exporter}, nil
}

func declaredExporter(manifest Manifest, id string) (Exporter, error) {
	if manifest.Backend == nil || !hasExporterPermission(manifest) {
		return Exporter{}, ErrDisabled
	}
	for _, exporter := range manifest.Contributes.Exporters {
		if exporter.ID == id {
			for _, command := range manifest.Contributes.Commands {
				if command.ID == exporter.Command {
					return exporter, nil
				}
			}
			return Exporter{}, ErrNotFound
		}
	}
	return Exporter{}, ErrNotFound
}

func (m *Manager) admitExporter(lease exporterLease) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	instance := lease.instance
	if m.closed || !m.started || m.owner == nil || m.instances[lease.record.Manifest.ID] != instance || !instance.ready || instance.ctx.Err() != nil {
		return ErrDisabled
	}
	if instance.inflight >= m.opts.MaxConcurrentInvocations {
		return ErrBusy
	}
	instance.inflight++
	return nil
}
