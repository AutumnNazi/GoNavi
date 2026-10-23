package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Invoke calls a declared command on the current generation with bounded time and concurrency.
func (m *Manager) Invoke(ctx context.Context, id, command string, args json.RawMessage) (json.RawMessage, error) {
	return m.invoke(ctx, id, 0, invocationTarget{command: command}, args)
}

// InvokeGeneration binds both admission and completion to an exact UI/runtime generation.
func (m *Manager) InvokeGeneration(ctx context.Context, id string, generation uint64, command string, args json.RawMessage) (json.RawMessage, error) {
	if generation == 0 {
		return nil, ErrDisabled
	}
	return m.invoke(ctx, id, generation, invocationTarget{command: command}, args)
}
func (m *Manager) invoke(ctx context.Context, id string, generation uint64, target invocationTarget, args json.RawMessage) (json.RawMessage, error) {
	if len(args) == 0 {
		args = json.RawMessage("{}")
	} else if len(args) > maxRPCBytes || !json.Valid(args) {
		return nil, fmt.Errorf("invalid or oversized command arguments")
	}
	inst, command, err := m.leaseInvocation(id, generation, target)
	if err != nil {
		return nil, err
	}
	defer func() { m.mu.Lock(); inst.inflight--; m.mu.Unlock() }()
	request, cancel := context.WithTimeout(ctx, m.opts.InvocationTimeout)
	defer cancel()
	stop := context.AfterFunc(inst.ctx, cancel)
	defer stop()
	result, err := inst.process.call(request, "plugin.invoke", struct {
		CommandID string          `json:"commandId"`
		Arguments json.RawMessage `json:"arguments"`
	}{command, args})
	if errors.Is(err, context.DeadlineExceeded) {
		m.mu.Lock()
		inst.ready = false
		m.mu.Unlock()
		m.quarantine(inst, fmt.Errorf("plugin command deadline exceeded"))
		inst.cancel()
	}
	if err != nil {
		return nil, err
	}
	current, loadErr := m.loadState()
	if loadErr != nil {
		return nil, loadErr
	}
	value, ok := current.Records[id]
	if !ok || !value.DesiredEnabled || value.Generation != inst.record.Generation {
		return nil, ErrDisabled
	}
	m.mu.Lock()
	valid := m.instances[id] == inst && inst.ready
	m.mu.Unlock()
	if !valid {
		return nil, ErrDisabled
	}
	return result, err
}
func (m *Manager) leaseInvocation(id string, generation uint64, target invocationTarget) (*instance, string, error) {
	if m.opts.Disabled {
		return nil, "", ErrDisabled
	}
	state, err := m.loadState()
	if err != nil {
		return nil, "", err
	}
	r, ok := state.Records[id]
	if !ok {
		return nil, "", ErrNotFound
	}
	if !r.DesiredEnabled || r.State != StateRunning || r.Quarantined || (generation != 0 && r.Generation != generation) || dependencyReason(r, state.Records) != "" {
		return nil, "", ErrDisabled
	}
	command, err := resolveInvocationCommand(r.Manifest, target)
	if err != nil {
		return nil, "", err
	}
	if target.command != "" && aiProviderCommandReserved(r.Manifest, command) {
		return nil, "", ErrAIProviderCommandReserved
	}
	if target.command != "" && exporterCommandReserved(r.Manifest, command) {
		return nil, "", ErrExporterCommandReserved
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, "", ErrClosed
	}
	inst := m.instances[id]
	if inst == nil || !inst.ready || inst.record.Generation != r.Generation || inst.record.Digest != r.Digest || inst.process == nil {
		return nil, "", ErrDisabled
	}
	if inst.inflight >= m.opts.MaxConcurrentInvocations {
		return nil, "", ErrBusy
	}
	inst.inflight++
	return inst, command, nil
}

// AssetPath resolves only regular immutable-package files of an enabled running generation.
func (m *Manager) AssetPath(id, relative string) (string, error) {
	if err := m.checkOpen(); err != nil {
		return "", err
	}
	if m.opts.Disabled {
		return "", ErrDisabled
	}
	if err := safePackagePath(relative); err != nil {
		return "", err
	}
	state, err := m.loadState()
	if err != nil {
		return "", err
	}
	r, ok := state.Records[id]
	if !ok {
		return "", ErrNotFound
	}
	if !r.DesiredEnabled || r.State != StateRunning || r.Quarantined {
		return "", ErrDisabled
	}
	root := m.packageRoot(r)
	for _, directory := range []string{filepath.Join(m.root, "store"), root} {
		info, err := os.Lstat(directory)
		if err != nil {
			return "", err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("plugin package directory is not immutable storage")
		}
	}
	path := root
	for _, segment := range strings.Split(relative, "/") {
		path = filepath.Join(path, segment)
		info, err := os.Lstat(path)
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("plugin asset links are forbidden")
		}
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("plugin asset is not a regular file")
	}
	return path, nil
}
