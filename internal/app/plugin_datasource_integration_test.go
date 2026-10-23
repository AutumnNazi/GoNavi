package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/plugin"
)

func buildHostDataSourceExample(t *testing.T) string {
	return buildHostDataSourcePackage(t, "read-only-database")
}

func buildHostDataSourcePackage(t *testing.T, example string) string {
	t.Helper()
	repo, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "plugin-package")
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, "go", "run", "./package", "-source", "./"+example, "-manifest", "./"+example+"/gonavi.plugin.json", "-output", output)
	command.Dir = filepath.Join(repo, "examples", "plugins")
	command.Env = append(os.Environ(), "GOWORK=off", "GOPROXY=off", "GOSUMDB=off")
	logs, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("build independent datasource: %v\n%s", err, logs)
	}
	return output
}

func installHostDataSourceExample(t *testing.T, path string) (*App, connection.ConnectionConfig) {
	t.Helper()
	a := newPluginTestApp(t)
	controller, err := plugin.NewManager(plugin.Options{Root: filepath.Join(a.configDir, "plugins")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := controller.Close(context.Background()); err != nil {
			t.Error(err)
		}
		a.evictPluginDataSourceCache("", 0)
	})
	inspection, err := controller.Inspect(a.ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := controller.Install(a.ctx, plugin.InstallRequest{Path: path, Digest: inspection.Digest, Trusted: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := controller.SetEnabled(a.ctx, inspection.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if len(inspection.Manifest.Contributes.DataSources) != 1 {
		t.Fatal("fixture data source missing")
	}
	identity := plugin.DataSourceType(inspection.Manifest.ID, inspection.Manifest.Contributes.DataSources[0])
	return a, connection.ConnectionConfig{Type: identity, Host: "memory", Database: "fixture", User: "selected-user", Password: "selected-only-test-secret", Timeout: 3}
}

func TestPluginDataSourceRealHostLifecycle(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	a, config := installHostDataSourceExample(t, buildHostDataSourceExample(t))
	preview := a.PluginDataSources()
	catalog, ok := preview.Data.(PluginDataSourceCatalog)
	if !preview.Success || !ok || len(catalog.Items) != 1 || catalog.Items[0].Available || !catalog.Items[0].Connectable {
		t.Fatalf("nonactivating catalog: %+v", preview)
	}
	for _, sql := range []string{"DELETE FROM people", "WITH changed AS (DELETE FROM people RETURNING *) SELECT * FROM changed", "SELECT * INTO copied FROM people"} {
		if result := a.DBQuery(config, "fixture", sql); result.Success {
			t.Fatalf("mutation accepted: %s", sql)
		}
	}
	if a.plugins.manager != nil {
		t.Fatal("rejected SQL or discovery activated plugin code")
	}
	if result := a.DBConnect(config); !result.Success {
		t.Fatalf("connect: %+v", result)
	}
	first, err := a.getDatabase(config)
	if err != nil {
		t.Fatal(err)
	}
	generation := first.(pluginDatabaseFreshness).PluginGeneration()
	for _, raw := range []string{
		`{"protocolVersion":1,"operation":"connect","sessionId":"untrusted-session","config":{"host":"memory","port":0,"database":"fixture"}}`,
		`{"protocolVersion":1,"operation":"query","sessionId":"untrusted-session","query":"DELETE FROM people"}`,
		`{"protocolVersion":1,"operation":"query","sessionId":"untrusted-session","query":"SELECT * FROM people"}`,
	} {
		if result := a.PluginInvoke("sdk.examples.readonly", "database", raw); result.Success {
			t.Fatal("generic plugin invoke bypassed the host datasource policy")
		}
	}
	for label, result := range map[string]connection.QueryResult{
		"databases": a.DBGetDatabasesContext(a.ctx, config),
		"tables":    a.DBGetTablesContext(a.ctx, config, "fixture"),
		"columns":   a.DBGetColumnsContext(a.ctx, config, "fixture", "people"),
		"query":     a.DBQuery(config, "fixture", "SELECT * FROM people"),
	} {
		if !result.Success {
			t.Fatalf("%s: %+v", label, result)
		}
	}
	rows, fields, err := first.(db.QueryContexter).QueryContext(a.ctx, "SELECT * FROM people")
	if err != nil || len(rows) != 3 || len(fields) != 3 || rows[0]["score"] != "9007199254740993" {
		t.Fatalf("exact fixture result: %v %v %v", rows, fields, err)
	}
	checkHostDataSourceRevocation(t, a, config, first, generation)
	if result := a.DBReleaseConnection(config); !result.Success {
		t.Fatalf("release: %+v", result)
	}
	a.mu.RLock()
	remaining := len(a.dbCache)
	a.mu.RUnlock()
	if remaining != 0 {
		t.Fatalf("plugin sessions left in cache: %d", remaining)
	}
}

func checkHostDataSourceRevocation(t *testing.T, a *App, config connection.ConnectionConfig, first db.Database, generation uint64) {
	t.Helper()
	id, _, _, _ := plugin.ParseDataSourceType(config.Type)
	queryCtx, cancel := context.WithCancel(a.ctx)
	defer cancel()
	started := make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		defer close(finished)
		close(started)
		_, _, err := first.(db.QueryContexter).QueryContext(queryCtx, "SELECT sleep_ms(5000)")
		finished <- err
	}()
	<-started
	disableStarted := time.Now()
	if result := a.PluginSetEnabled(id, false); !result.Success {
		t.Fatalf("disable: %+v", result)
	}
	if time.Since(disableStarted) > time.Second {
		t.Fatal("disable waited for the active datasource query")
	}
	select {
	case err := <-finished:
		if err == nil {
			t.Fatal("query succeeded after its generation was disabled")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("disable did not cancel the datasource query")
	}
	if _, _, err := first.Query("SELECT 1"); err == nil {
		t.Fatal("stale cached handle executed after disable")
	}
	if result := a.DBQuery(config, "fixture", "SELECT 1"); result.Success {
		t.Fatal("disabled source accepted query")
	}
	if result := a.PluginSetEnabled(id, true); !result.Success {
		t.Fatalf("reenable: %+v", result)
	}
	next, err := a.getDatabase(config)
	if err != nil {
		t.Fatal(err)
	}
	if next == first || next.(pluginDatabaseFreshness).PluginGeneration() == generation {
		t.Fatal("reenable reused old generation")
	}
	if first.(pluginDatabaseFreshness).IsCurrent() {
		t.Fatal("stale handle remained current")
	}
	if err := first.(*db.PluginDatabase).WaitClosed(a.ctx); err != nil {
		t.Fatalf("stale handle was not closed: %v", err)
	}
	if result := a.DBQuery(config, "fixture", "SELECT 1"); !result.Success {
		t.Fatalf("fresh generation query: %+v", result)
	}
}

func TestPluginDataSourceMetadataBorrowsRootAndCancellation(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	a, config := installHostDataSourceExample(t, buildHostDataSourceExample(t))
	ctx, cancel := context.WithCancel(a.ctx)
	session := newMetadataSessionWithMode(a, ctx, true)
	defer session.Close()
	if session.owner != a || session.app.pluginDataSourceOwner() != a {
		t.Fatal("metadata did not borrow root owner")
	}
	instance, err := session.app.getDatabaseWithContextLane(ctx, config, false, metadataLaneCacheKeySuffix)
	if err != nil {
		t.Fatal(err)
	}
	if session.app.plugins.manager != nil || a.plugins.manager == nil {
		t.Fatal("metadata created a competing plugin owner")
	}
	cancel()
	if _, _, err := instance.(db.QueryContexter).QueryContext(ctx, "SELECT sleep_ms(5000)"); !errors.Is(err, context.Canceled) {
		t.Fatalf("metadata cancellation: %v", err)
	}
	if session.app.configDir != a.configDir {
		t.Fatal("metadata borrowed the wrong data root")
	}
}

func TestPluginDataSourceRejectedSettingsDoNotLeakCredentials(t *testing.T) {
	a, config := installHostDataSourceExample(t, buildHostDataSourceExample(t))
	config.UseSSH = true
	config.SSH.Password = "ssh-private-test-secret"
	logPath := logger.Path()
	before, _ := os.ReadFile(logPath)
	result := a.TestConnection(config)
	if result.Success {
		t.Fatal("unsupported SSH was ignored")
	}
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), config.Password) || strings.Contains(string(raw), config.SSH.Password) {
		t.Fatal("credentials leaked in failure result")
	}
	if a.plugins.manager != nil {
		t.Fatal("unsupported transport activated plugin runtime")
	}
	if logPath != "" {
		logged, err := os.ReadFile(logPath)
		if err != nil {
			t.Fatal(err)
		}
		if len(logged) >= len(before) {
			logged = logged[len(before):]
		}
		if strings.Contains(string(logged), config.Password) || strings.Contains(string(logged), config.SSH.Password) {
			t.Fatal("selected credentials leaked to the host log")
		}
	}
}
