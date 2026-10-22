package db

import (
	"context"
	"encoding/json"
	"errors"

	"GoNavi-Wails/internal/connection"
)

// GetDatabases returns a bounded catalog without creating another plugin session.
func (p *PluginDatabase) GetDatabases() ([]string, error) {
	return p.readNames(metadataContextFor(p), pluginDatabaseRequest{Operation: "databases"})
}

// GetTables forwards only the caller-selected database metadata identity.
func (p *PluginDatabase) GetTables(database string) ([]string, error) {
	return p.readNames(metadataContextFor(p), pluginDatabaseRequest{Operation: "tables", Database: database})
}

func (p *PluginDatabase) readNames(ctx context.Context, request pluginDatabaseRequest) ([]string, error) {
	if err := validatePluginMetadataRequest(request); err != nil {
		return nil, err
	}
	response, err := p.call(ctx, request, false)
	if err != nil {
		return nil, err
	}
	names, err := decodePluginNames(response)
	if err != nil {
		return nil, p.checkedResponse(err)
	}
	if err := p.finishRead(ctx); err != nil {
		return nil, err
	}
	return names, nil
}

// GetCreateStatement returns DDL as bounded display data; it never executes it.
func (p *PluginDatabase) GetCreateStatement(database, table string) (string, error) {
	request := pluginDatabaseRequest{Operation: "createStatement", Database: database, Table: table}
	if err := validatePluginMetadataRequest(request); err != nil {
		return "", err
	}
	ctx := metadataContextFor(p)
	response, err := p.call(ctx, request, false)
	if err != nil {
		return "", err
	}
	statement, err := decodePluginStatement(response)
	if err != nil {
		return "", p.checkedResponse(err)
	}
	if err := p.finishRead(ctx); err != nil {
		return "", err
	}
	return statement, nil
}

// GetColumns uses the metadata context bound to an isolated instance.
func (p *PluginDatabase) GetColumns(database, table string) ([]connection.ColumnDefinition, error) {
	return p.GetColumnsContext(metadataContextFor(p), database, table)
}

// GetColumnsContext keeps metadata cancellation on this exact generation/session.
func (p *PluginDatabase) GetColumnsContext(ctx context.Context, database, table string) ([]connection.ColumnDefinition, error) {
	return readPluginMetadata(ctx, p, pluginDatabaseRequest{Operation: "columns", Database: database, Table: table},
		"columns", []string{"name", "type", "nullable", "key", "default", "extra", "comment"}, validatePluginColumns)
}

// GetAllColumns returns explicit table-qualified column metadata.
func (p *PluginDatabase) GetAllColumns(database string) ([]connection.ColumnDefinitionWithTable, error) {
	return readPluginMetadata(metadataContextFor(p), p, pluginDatabaseRequest{Operation: "allColumns", Database: database},
		"allColumns", []string{"tableName", "name", "type"}, validatePluginAllColumns)
}

// GetIndexes returns bounded standard index DTOs, without write capabilities.
func (p *PluginDatabase) GetIndexes(database, table string) ([]connection.IndexDefinition, error) {
	return readPluginMetadata(metadataContextFor(p), p, pluginDatabaseRequest{Operation: "indexes", Database: database, Table: table},
		"indexes", []string{"name", "columnName", "nonUnique", "seqInIndex", "indexType"}, validatePluginIndexes)
}

// GetForeignKeys returns bounded standard foreign-key DTOs.
func (p *PluginDatabase) GetForeignKeys(database, table string) ([]connection.ForeignKeyDefinition, error) {
	return readPluginMetadata(metadataContextFor(p), p, pluginDatabaseRequest{Operation: "foreignKeys", Database: database, Table: table},
		"foreignKeys", []string{"name", "columnName", "refTableName", "refColumnName", "constraintName"}, validatePluginForeignKeys)
}

// GetTriggers returns bounded trigger text as metadata, never executable code.
func (p *PluginDatabase) GetTriggers(database, table string) ([]connection.TriggerDefinition, error) {
	return readPluginMetadata(metadataContextFor(p), p, pluginDatabaseRequest{Operation: "triggers", Database: database, Table: table},
		"triggers", []string{"name", "timing", "event", "statement"}, validatePluginTriggers)
}

func readPluginMetadata[T any](ctx context.Context, p *PluginDatabase, request pluginDatabaseRequest, key string, required []string, validate func([]T) error) ([]T, error) {
	if err := validatePluginMetadataRequest(request); err != nil {
		return nil, err
	}
	response, err := p.call(ctx, request, false)
	if err != nil {
		return nil, err
	}
	envelope, err := pluginDatabaseEnvelope(response, key)
	if err != nil {
		return nil, p.checkedResponse(err)
	}
	result, err := decodePluginDatabaseArray[T](envelope[key], required)
	if err == nil {
		err = validate(result)
	}
	if err != nil {
		return nil, p.checkedResponse(err)
	}
	if err := p.finishRead(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

func validatePluginMetadataRequest(request pluginDatabaseRequest) error {
	requiresTable := request.Operation != "databases" && request.Operation != "tables" && request.Operation != "allColumns"
	if !validPluginDatabaseText(request.Database, pluginDatabaseMaxName, false) || !validPluginDatabaseText(request.Table, pluginDatabaseMaxName, requiresTable) {
		return errors.New("plugin database metadata identity is invalid")
	}
	return nil
}

func decodePluginNames(payload json.RawMessage) ([]string, error) {
	envelope, err := pluginDatabaseEnvelope(payload, "names")
	if err != nil {
		return nil, err
	}
	var names []string
	if err := decodePluginDatabaseValue(envelope["names"], &names); err != nil || names == nil || len(names) > pluginDatabaseMaxNames {
		return nil, ErrPluginDatabaseProtocol
	}
	seen := make(map[string]struct{}, len(names))
	for _, name := range names {
		if !validPluginDatabaseText(name, pluginDatabaseMaxName, true) {
			return nil, ErrPluginDatabaseProtocol
		}
		if _, duplicate := seen[name]; duplicate {
			return nil, ErrPluginDatabaseProtocol
		}
		seen[name] = struct{}{}
	}
	return names, nil
}

func decodePluginStatement(payload json.RawMessage) (string, error) {
	envelope, err := pluginDatabaseEnvelope(payload, "statement")
	if err != nil {
		return "", err
	}
	var statement string
	if err := decodePluginDatabaseValue(envelope["statement"], &statement); err != nil || !validPluginDatabaseText(statement, pluginDatabaseMaxQuery, true) {
		return "", ErrPluginDatabaseProtocol
	}
	return statement, nil
}
