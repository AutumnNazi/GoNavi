package plugin

import (
	"context"
	"encoding/json"
	"errors"
)

// ErrDataSourceCommandReserved rejects generic invocation of a host-managed driver command.
var ErrDataSourceCommandReserved = errors.New("plugin data source command requires host-managed invocation")

type invocationTarget struct {
	command  string
	sourceID string
}

// InvokeDataSourceGeneration dispatches a datasource operation for a trusted host adapter.
// The adapter must enforce its session, read-only SQL and connection policies first.
// This method is not a generic UI/Agent gateway and must never be exposed as a Wails binding.
// The runtime resolves the actual declaration and command in the same generation snapshot
// used for admission, then applies the ordinary bounded RPC and completion fences.
func (m *Manager) InvokeDataSourceGeneration(ctx context.Context, id string, generation uint64, sourceID string, args json.RawMessage) (json.RawMessage, error) {
	if generation == 0 {
		return nil, ErrDisabled
	}
	if !dataSourceIDPattern.MatchString(sourceID) {
		return nil, ErrNotFound
	}
	return m.invoke(ctx, id, generation, invocationTarget{sourceID: sourceID}, args)
}

func resolveInvocationCommand(manifest Manifest, target invocationTarget) (string, error) {
	command := target.command
	if target.sourceID != "" {
		if command != "" {
			return "", ErrNotFound
		}
		var err error
		command, err = dataSourceInvocationCommand(manifest, target.sourceID)
		if err != nil {
			return "", err
		}
	} else {
		// Reservation is unconditional: arguments and ai.tools permission cannot grant driver authority.
		for _, source := range manifest.Contributes.DataSources {
			if source.Command == command {
				return "", ErrDataSourceCommandReserved
			}
		}
	}
	for _, declared := range manifest.Contributes.Commands {
		if declared.ID == command {
			return command, nil
		}
	}
	return "", ErrNotFound
}

func dataSourceInvocationCommand(manifest Manifest, sourceID string) (string, error) {
	if manifest.Backend == nil {
		return "", ErrDisabled
	}
	permitted := false
	for _, permission := range manifest.Permissions {
		if permission == "data.sources" {
			permitted = true
			break
		}
	}
	if !permitted {
		return "", ErrDisabled
	}
	for _, source := range manifest.Contributes.DataSources {
		if source.ID != sourceID {
			continue
		}
		if DataSourceType(manifest.ID, source) == "" {
			return "", ErrDisabled
		}
		return source.Command, nil
	}
	return "", ErrNotFound
}
