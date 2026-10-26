package main

import (
	"context"
	"errors"
	"sync"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

type fixture struct {
	mu       sync.Mutex
	sessions map[string]bool
}

func newFixture() *fixture { return &fixture{sessions: make(map[string]bool)} }

func (f *fixture) operations() plugin.DataSourceOperations {
	return plugin.DataSourceOperations{
		Connect: f.connect, Ping: f.check, Close: f.close, Query: f.query,
		Databases: func(ctx context.Context, r plugin.DataSourceRequest) ([]string, error) {
			if err := f.check(ctx, r); err != nil {
				return nil, err
			}
			return []string{"fixture"}, nil
		},
		Tables: func(ctx context.Context, r plugin.DataSourceRequest) ([]string, error) {
			if err := f.check(ctx, r); err != nil {
				return nil, err
			}
			return []string{"people"}, nil
		},
		CreateStatement: func(ctx context.Context, r plugin.DataSourceRequest) (string, error) {
			if err := f.table(ctx, r); err != nil {
				return "", err
			}
			return `CREATE TABLE "people" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "score" INTEGER NOT NULL)`, nil
		},
		Columns: f.columns, AllColumns: f.allColumns,
		Indexes: func(ctx context.Context, r plugin.DataSourceRequest) ([]plugin.DataSourceIndexDefinition, error) {
			if err := f.table(ctx, r); err != nil {
				return nil, err
			}
			return []plugin.DataSourceIndexDefinition{{Name: "people_pk", ColumnName: "id", NonUnique: 0, SeqInIndex: 1, IndexType: "BTREE"}}, nil
		},
		ForeignKeys: func(ctx context.Context, r plugin.DataSourceRequest) ([]plugin.DataSourceForeignKeyDefinition, error) {
			if err := f.table(ctx, r); err != nil {
				return nil, err
			}
			return []plugin.DataSourceForeignKeyDefinition{}, nil
		},
		Triggers: func(ctx context.Context, r plugin.DataSourceRequest) ([]plugin.DataSourceTriggerDefinition, error) {
			if err := f.table(ctx, r); err != nil {
				return nil, err
			}
			return []plugin.DataSourceTriggerDefinition{}, nil
		},
	}
}

func (f *fixture) connect(ctx context.Context, r plugin.DataSourceRequest) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c := r.Config
	if c == nil || (c.Host != "" && c.Host != "memory") || c.Port != 0 || (c.Database != "" && c.Database != "fixture") || c.ConnectionParams != "" {
		return errors.New("fixture requires memory host, port zero, fixture database and no connection parameters")
	}
	// This local fixture has no authentication; credentials are neither stored nor logged.
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	f.sessions[r.SessionID] = true
	return nil
}

func (f *fixture) close(_ context.Context, r plugin.DataSourceRequest) error {
	f.mu.Lock()
	delete(f.sessions, r.SessionID)
	f.mu.Unlock()
	return nil
}

func (f *fixture) check(ctx context.Context, r plugin.DataSourceRequest) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	f.mu.Lock()
	exists := f.sessions[r.SessionID]
	f.mu.Unlock()
	if !exists {
		return errors.New("fixture session is closed")
	}
	if r.Database != "" && r.Database != "fixture" {
		return errors.New("fixture database does not exist")
	}
	return nil
}

func (f *fixture) table(ctx context.Context, r plugin.DataSourceRequest) error {
	if err := f.check(ctx, r); err != nil {
		return err
	}
	if r.Table != "people" {
		return errors.New("fixture table does not exist")
	}
	return nil
}

func (f *fixture) columns(ctx context.Context, r plugin.DataSourceRequest) ([]plugin.DataSourceColumnDefinition, error) {
	if err := f.table(ctx, r); err != nil {
		return nil, err
	}
	return []plugin.DataSourceColumnDefinition{
		{Name: "id", Type: "INTEGER", Nullable: "NO", Key: "PRI", Comment: "Stable fixture identifier"},
		{Name: "name", Type: "TEXT", Nullable: "NO", Comment: "Fixture display name"},
		{Name: "score", Type: "INTEGER", Nullable: "NO", Comment: "Includes a value beyond JavaScript safe integer range"},
	}, nil
}

func (f *fixture) allColumns(ctx context.Context, r plugin.DataSourceRequest) ([]plugin.DataSourceColumnDefinitionWithTable, error) {
	if err := f.check(ctx, r); err != nil {
		return nil, err
	}
	return []plugin.DataSourceColumnDefinitionWithTable{
		{TableName: "people", Name: "id", Type: "INTEGER"},
		{TableName: "people", Name: "name", Type: "TEXT"},
		{TableName: "people", Name: "score", Type: "INTEGER"},
	}, nil
}
