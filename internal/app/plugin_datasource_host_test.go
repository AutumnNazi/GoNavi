package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/plugin"
)

func dataSourceViewStatus() plugin.Status {
	return plugin.Status{Manifest: plugin.Manifest{ID: "test.reader", Name: "Reader", Version: "1.0.0", Permissions: []string{"data.sources"},
		Backend:     &plugin.Backend{Default: &plugin.Entry{Executable: "bin/plugin"}},
		Contributes: plugin.Contributions{Commands: []plugin.Command{{ID: "database", Title: "Database"}}, DataSources: []plugin.DataSource{{ID: "fixture", Name: "Fixture", Dialect: "sqlite", Command: "database", ReadOnly: true}}}},
		Generation: 2, State: plugin.StateRunning, DesiredEnabled: true}
}

func TestPluginDataSourceCatalogAvailabilityTruth(t *testing.T) {
	for _, tt := range []struct {
		name                                         string
		state                                        plugin.State
		enabled, owned, safe, available, connectable bool
	}{
		{name: "running local", state: plugin.StateRunning, enabled: true, owned: true, available: true, connectable: true},
		{name: "running elsewhere", state: plugin.StateRunning, enabled: true, connectable: true},
		{name: "cold eligible", state: plugin.StateDisabled, enabled: true, connectable: true},
		{name: "starting", state: plugin.StateStarting, enabled: true, owned: true, connectable: true},
		{name: "disabled", state: plugin.StateDisabled, owned: true},
		{name: "faulted", state: plugin.StateFaulted, enabled: true, owned: true},
		{name: "blocked", state: plugin.StateBlocked, enabled: true, owned: true},
		{name: "stopping", state: plugin.StateStopping, enabled: true, owned: true},
		{name: "safe mode", state: plugin.StateRunning, enabled: true, owned: true, safe: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			status := dataSourceViewStatus()
			status.State = tt.state
			status.DesiredEnabled = tt.enabled
			items := pluginDataSourceViews([]plugin.Status{status}, tt.safe, tt.owned)
			if len(items) != 1 || items[0].Available != tt.available || items[0].Connectable != tt.connectable || !items[0].ReadOnly || items[0].State != tt.state {
				t.Fatalf("catalog: %+v", items)
			}
		})
	}
	empty, err := json.Marshal(PluginDataSourceCatalog{Items: pluginDataSourceViews(nil, false, false)})
	if err != nil || string(empty) != `{"items":[]}` {
		t.Fatalf("empty catalog: %s %v", empty, err)
	}
	status := dataSourceViewStatus()
	status.Generation = 1 << 53
	if items := pluginDataSourceViews([]plugin.Status{status}, false, true); len(items) != 0 {
		t.Fatal("unsafe JS generation advertised")
	}
}

func TestPluginDataSourceWritableRequiresExplicitConnectionOptIn(t *testing.T) {
	for _, test := range []struct {
		name         string
		sourceReadOn bool
		pluginWrite  bool
		readOnly     bool
		want         bool
	}{
		{name: "writable source without opt-in", sourceReadOn: false, pluginWrite: false, readOnly: false, want: false},
		{name: "writable source opted in", sourceReadOn: false, pluginWrite: true, readOnly: false, want: true},
		{name: "writable source with read-only switch", sourceReadOn: false, pluginWrite: true, readOnly: true, want: false},
		{name: "read-only source with opt-in", sourceReadOn: true, pluginWrite: true, readOnly: false, want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			config := connection.ConnectionConfig{PluginWritable: test.pluginWrite, ReadOnly: test.readOnly}
			if got := pluginDataSourceWriteEnabled(test.sourceReadOn, config); got != test.want {
				t.Fatalf("writable = %v, want %v", got, test.want)
			}
		})
	}
}

func TestPluginDataSourceMalformedAPITypeNeverReachesBuiltinFactory(t *testing.T) {
	originalFactory, originalDial := newDatabaseFunc, resolveDialConfigWithProxyFunc
	t.Cleanup(func() { newDatabaseFunc = originalFactory; resolveDialConfigWithProxyFunc = originalDial })
	factoryCalls, dialCalls := 0, 0
	newDatabaseFunc = func(string) (db.Database, error) {
		factoryCalls++
		return nil, errors.New("unexpected builtin factory")
	}
	resolveDialConfigWithProxyFunc = func(config connection.ConnectionConfig) (connection.ConnectionConfig, error) {
		dialCalls++
		return config, errors.New("unexpected host transport")
	}
	a := newPluginTestApp(t)
	a.headlessRuntime = true
	for _, identity := range []string{"Plugin:test.reader:fixture:sqlite", "plugin:TEST.reader:fixture:sqlite", "plugin:test.reader:Fixture:sqlite", "plugin:test.reader:fixture:SQLITE", " plugin:test.reader:fixture:sqlite", "plugin:test.reader:fixture:mysql:extra", "plugin", "PLuGiN"} {
		config := connection.ConnectionConfig{ID: "must-not-resolve-saved-id", Type: identity, Host: "memory"}
		if result := a.TestConnection(config); result.Success {
			t.Fatalf("forged type accepted: %q", identity)
		}
		if result := a.DBConnect(config); result.Success {
			t.Fatalf("forged cached type accepted: %q", identity)
		}
		if _, err := a.resolveEffectiveConnectionConfig(config); err == nil || !strings.Contains(err.Error(), "invalid plugin data source") {
			t.Fatalf("namespace was normalized or secrets were read first: %q %v", identity, err)
		}
	}
	if factoryCalls != 0 || dialCalls != 0 || a.plugins.manager != nil {
		t.Fatalf("forged namespace touched builtin/transport/runtime: %d %d", factoryCalls, dialCalls)
	}
}

type pluginBuiltinProbe struct {
	db.Database
	connects, closes int
}

func (p *pluginBuiltinProbe) Connect(connection.ConnectionConfig) error { p.connects++; return nil }
func (p *pluginBuiltinProbe) Ping() error                               { return nil }
func (p *pluginBuiltinProbe) Close() error                              { p.closes++; return nil }

func TestPluginDataSourceBuiltinFactorySeamsRemainUnchanged(t *testing.T) {
	originalFactory, originalDial := newDatabaseFunc, resolveDialConfigWithProxyFunc
	t.Cleanup(func() { newDatabaseFunc = originalFactory; resolveDialConfigWithProxyFunc = originalDial })
	var instances []*pluginBuiltinProbe
	newDatabaseFunc = func(identity string) (db.Database, error) {
		if identity != "mysql" {
			t.Fatalf("builtin identity changed: %q", identity)
		}
		value := &pluginBuiltinProbe{}
		instances = append(instances, value)
		return value, nil
	}
	dialCalls := 0
	resolveDialConfigWithProxyFunc = func(config connection.ConnectionConfig) (connection.ConnectionConfig, error) {
		dialCalls++
		return config, nil
	}
	a := newPluginTestApp(t)
	config := connection.ConnectionConfig{Type: "mysql", Host: "localhost"}
	isolated, err := a.openDatabaseIsolated(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := isolated.Close(); err != nil {
		t.Fatal(err)
	}
	cached, err := a.getDatabase(config)
	if err != nil {
		t.Fatal(err)
	}
	again, err := a.getDatabase(config)
	if err != nil || again != cached {
		t.Fatalf("builtin cache reuse changed: %v", err)
	}
	if dialCalls != 2 || len(instances) != 2 || instances[0].connects != 1 || instances[1].connects != 1 {
		t.Fatalf("builtin seams changed: dial=%d instances=%d", dialCalls, len(instances))
	}
	if a.plugins.manager != nil {
		t.Fatal("builtin database lookup activated plugins")
	}
	a.releaseCachedDatabaseConnectionsForConfig(config)
}

func TestPluginDataSourceCancelledOrUnavailableDiscoveryCannotActivate(t *testing.T) {
	a := newPluginTestApp(t)
	ctx, cancel := context.WithCancel(a.ctx)
	cancel()
	if _, err := a.pluginDataSourceStatuses(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled discovery: %v", err)
	}
	capability := a.DataSourceCapability(connection.ConnectionConfig{Type: "plugin:missing.reader:source:mysql"})
	if capability.Query.Supported || capability.Metadata.Supported || capability.Transaction.Supported || capability.DangerousOperations.Supported || capability.UI.MockData || !capability.UI.ForceReadOnlyQueryResult || !capability.UI.ForceReadOnlyStructureDesigner {
		t.Fatalf("unavailable capability: %+v", capability)
	}
	if a.plugins.manager != nil {
		t.Fatal("discovery/capability started runtime")
	}
}
