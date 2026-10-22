package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/plugin"
)

type pluginDispatchProbe struct {
	*db.PluginDatabase
	queries    int
	execs      int
	columns    int
	columnName string
}

func (p *pluginDispatchProbe) Query(string) ([]map[string]any, []string, error) {
	p.queries++
	return []map[string]any{{"value": 1}}, []string{"value"}, nil
}
func (p *pluginDispatchProbe) QueryContext(_ context.Context, query string) ([]map[string]any, []string, error) {
	return p.Query(query)
}
func (p *pluginDispatchProbe) Exec(string) (int64, error) {
	p.execs++
	return 0, errors.New("readonly query reached Exec")
}
func (p *pluginDispatchProbe) ExecContext(_ context.Context, query string) (int64, error) {
	return p.Exec(query)
}
func (p *pluginDispatchProbe) GetColumns(string, string) ([]connection.ColumnDefinition, error) {
	p.columns++
	return []connection.ColumnDefinition{{Name: p.columnName, Type: "TEXT", Nullable: "YES"}}, nil
}
func (p *pluginDispatchProbe) GetColumnsContext(_ context.Context, database, table string) ([]connection.ColumnDefinition, error) {
	return p.GetColumns(database, table)
}

// A real installed SDK instance supplies catalog eligibility and cache generation;
// this probe replaces only dispatch so quoting tests do not require an SQL server.
func installPluginDispatchProbe(t *testing.T, a *App, config connection.ConnectionConfig, lane string, name string) *pluginDispatchProbe {
	t.Helper()
	instance, err := a.getDatabaseWithContextLane(a.ctx, config, false, lane)
	if err != nil {
		t.Fatal(err)
	}
	real, ok := instance.(*db.PluginDatabase)
	if !ok {
		t.Fatalf("expected real plugin adapter, got %T", instance)
	}
	probe := &pluginDispatchProbe{PluginDatabase: real, columnName: name}
	replaced := false
	a.mu.Lock()
	for key, entry := range a.dbCache {
		if entry.inst == instance {
			entry.inst = probe
			a.dbCache[key] = entry
			replaced = true
		}
	}
	a.mu.Unlock()
	if !replaced {
		t.Fatal("generation-bound cache entry not found")
	}
	return probe
}

func TestPluginDataSourcePublicQueryUsesDeclaredDialect(t *testing.T) {
	packagePath := buildHostDataSourceExample(t)
	manifestPath := filepath.Join(packagePath, "gonavi.plugin.json")
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var manifest plugin.Manifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct{ dialect, query string }{
		{dialect: "sqlite", query: `SELECT [update] FROM [delete]`},
		{dialect: "mysql", query: "SELECT \x60update\x60 FROM \x60delete\x60"},
		{dialect: "postgres", query: `SELECT $body$update; delete$body$ AS "update" FROM "delete"`},
	} {
		t.Run(tt.dialect, func(t *testing.T) {
			manifest.Contributes.DataSources[0].Dialect = tt.dialect
			encoded, err := json.Marshal(manifest)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(manifestPath, encoded, 0600); err != nil {
				t.Fatal(err)
			}
			a, config := installHostDataSourceExample(t, packagePath)
			config = normalizeRunConfig(config, "fixture")
			probe := installPluginDispatchProbe(t, a, config, "", "")
			if err := validatePluginReadOnlyQuery(config.Type, tt.query, a.appText); err != nil {
				t.Fatalf("preflight must accept quoted identifiers: %v", err)
			}
			results := []connection.QueryResult{
				a.DBQuery(config, "fixture", tt.query),
				a.DBQueryWithCancel(config, "fixture", tt.query, "quoted-identifiers"),
				a.DBQueryMulti(config, "fixture", tt.query, "quoted-multi"),
				NewCLIQueryExecutor(a).DBQueryMulti(a.ctx, config, "fixture", tt.query, "quoted-cli"),
			}
			for i, result := range results {
				if !result.Success {
					t.Errorf("public query%d failed: %s (query=%d exec=%d)", i, result.Message, probe.queries, probe.execs)
				}
			}
			if probe.queries != 4 || probe.execs != 0 {
				t.Fatalf("wrong readonly dispatch: query=%d exec=%d", probe.queries, probe.execs)
			}
		})
	}
}

func TestPluginDataSourceMetadataResultCacheFencesReenable(t *testing.T) {
	a, config := installHostDataSourceExample(t, buildHostDataSourceExample(t))
	config = normalizeMetadataRunConfig(config, "fixture")
	first := installPluginDispatchProbe(t, a, config, metadataLaneCacheKeySuffix, "old-generation")
	initial := a.DBGetColumns(config, "fixture", "people")
	if !initial.Success || first.columns != 1 {
		t.Fatalf("initial metadata: %+v calls=%d", initial, first.columns)
	}
	if current := a.DBGetColumns(config, "fixture", "people"); !current.Success || first.columns < 1 {
		t.Fatalf("same generation metadata failed: %+v calls=%d", current, first.columns)
	}
	id, _, _, _ := plugin.ParseDataSourceType(config.Type)
	if result := a.PluginSetEnabled(id, false); !result.Success {
		t.Fatalf("disable: %+v", result)
	}
	if denied := a.DBGetColumns(config, "fixture", "people"); denied.Success {
		t.Fatalf("disabled public metadata API returned cached rows: %+v", denied)
	}
	if result := a.PluginSetEnabled(id, true); !result.Success {
		t.Fatalf("reenable: %+v", result)
	}
	next := installPluginDispatchProbe(t, a, config, metadataLaneCacheKeySuffix, "new-generation")
	if first.PluginGeneration() == next.PluginGeneration() {
		t.Fatal("test failed to advance real runtime generation")
	}
	result := a.DBGetColumns(config, "fixture", "people")
	columns, ok := result.Data.([]connection.ColumnDefinition)
	if !result.Success || !ok || len(columns) != 1 || columns[0].Name != "new-generation" || next.columns != 1 {
		t.Fatalf("stale metadata result: %+v newCalls=%d", result, next.columns)
	}
}
