package plugin

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

func (m *Manager) acceptHostDescribe(inst *instance, process *rpcProcess, params json.RawMessage) (json.RawMessage, error) {
	if !process.allowHostLog() {
		return nil, errHostLogBusy
	}
	m.mu.Lock()
	current := m.instances[inst.record.Manifest.ID]
	live := current == inst && inst.process == process && inst.ctx.Err() == nil
	permitted := hasPermission(inst.record.Manifest, "host.describe")
	body := map[string]any{
		"pluginId":    inst.record.Manifest.ID,
		"generation":  inst.record.Generation,
		"hostVersion": m.opts.HostVersion,
		"locale":      m.opts.Locale,
	}
	m.mu.Unlock()
	if !live || !permitted {
		return nil, errHostLogDenied
	}
	if err := emptyHostObject(params); err != nil {
		return nil, err
	}
	return json.Marshal(body)
}

func hasPermission(manifest Manifest, name string) bool {
	for _, permission := range manifest.Permissions {
		if permission == name {
			return true
		}
	}
	return false
}

func emptyHostObject(params json.RawMessage) error {
	trimmed := bytes.TrimSpace(params)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil
	}
	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&struct{}{}); err != nil {
		return errHostLogParams
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errHostLogParams
	}
	return nil
}
