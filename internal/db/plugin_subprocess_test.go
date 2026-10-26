package db

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/plugin"
)

func TestPluginDatabaseRealSDKSubprocess(t *testing.T) {
	if testing.Short() {
		t.Skip("builds the independent SDK example subprocess")
	}
	source, manifest := buildPluginDatabaseSDKFixture(t)
	manager, err := plugin.NewManager(plugin.Options{Root: t.TempDir(), HostVersion: "1.0.0", HandshakeTimeout: 5 * time.Second,
		HeartbeatInterval: 100 * time.Millisecond, HeartbeatTimeout: 300 * time.Millisecond, ShutdownTimeout: 300 * time.Millisecond,
		InvocationTimeout: 3 * time.Second, ReconcileInterval: 10 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	life, stopRuntime := context.WithCancel(context.Background())
	t.Cleanup(func() {
		stopRuntime()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := manager.Close(ctx); err != nil {
			t.Error(err)
		}
	})
	if err := manager.Start(life); err != nil {
		t.Fatal(err)
	}
	inspection, err := manager.Inspect(t.Context(), source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Install(t.Context(), plugin.InstallRequest{Path: source, Digest: inspection.Digest, Trusted: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetEnabled(t.Context(), manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	status := waitPluginDatabaseRuntime(t, manager, manifest.ID, plugin.StateRunning)
	database := openRealPluginDatabase(t, manager, status)
	verifyPluginDatabaseSDKMetadata(t, database)
	rows, fields, err := database.QueryContext(t.Context(), "SELECT * FROM people")
	if err != nil || len(rows) != 3 || len(fields) != 3 || rows[0]["score"] != "9007199254740993" {
		t.Fatalf("SDK query mismatch: rows=%d fields=%d err=%v", len(rows), len(fields), err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	timer := time.AfterFunc(50*time.Millisecond, cancel)
	started := time.Now()
	_, _, err = database.QueryContext(ctx, "SELECT sleep_ms(2000)")
	timer.Stop()
	cancel()
	if !errors.Is(err, context.Canceled) || time.Since(started) > time.Second {
		t.Fatalf("SDK cancellation=%v after=%v", err, time.Since(started))
	}
	if _, _, err := database.QueryContext(t.Context(), "SELECT 1"); err != nil {
		t.Fatalf("cancellation killed reusable readonly session: %v", err)
	}
	if _, _, err := database.QueryContext(t.Context(), "DELETE FROM people"); !errors.Is(err, ErrPluginDatabaseReadOnly) {
		t.Fatal("write reached SDK")
	}
	disableDuringPluginDatabaseQuery(t, manager, database, manifest.ID)
	if database.IsCurrent() {
		t.Fatal("disabled SDK session remained current")
	}
	if _, _, err := database.QueryContext(t.Context(), "SELECT 1"); !errors.Is(err, ErrPluginDatabaseUnavailable) {
		t.Fatal("disabled session dispatched")
	}
	waitPluginDatabaseRuntime(t, manager, manifest.ID, plugin.StateDisabled)
	if _, err := manager.SetEnabled(t.Context(), manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	replacement := waitPluginDatabaseRuntime(t, manager, manifest.ID, plugin.StateRunning)
	if replacement.Generation == status.Generation {
		t.Fatal("runtime generation reused")
	}
	fresh := openRealPluginDatabase(t, manager, replacement)
	if fresh.sessionID == database.sessionID {
		t.Fatal("SDK session replayed on re-enable")
	}
	if _, _, err := database.QueryContext(t.Context(), "SELECT 1"); !errors.Is(err, ErrPluginDatabaseUnavailable) {
		t.Fatal("stale adapter followed replacement process")
	}
	if _, _, err := fresh.QueryContext(t.Context(), "SELECT 1"); err != nil {
		t.Fatal(err)
	}
	if err := fresh.Close(); err != nil {
		t.Fatalf("live provider close failed: %v", err)
	}
	orphan := openRealPluginDatabase(t, manager, replacement)
	if err := manager.Close(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := orphan.Close(); err != nil {
		t.Fatalf("runtime-gone local cleanup failed: %v", err)
	}
}

func disableDuringPluginDatabaseQuery(t *testing.T, manager *plugin.Manager, database *PluginDatabase, id string) {
	t.Helper()
	// One result is buffered so the timer callback never outlives its join below.
	disabled := make(chan error, 1)
	timer := time.AfterFunc(50*time.Millisecond, func() {
		start := time.Now()
		_, err := manager.SetEnabled(t.Context(), id, false)
		// Still well below the 2s the query would need to finish, so this keeps proving that
		// disable interrupts the invocation instead of waiting for it, while leaving room for a
		// loaded runner to finish the shutdown bookkeeping.
		if err == nil && time.Since(start) > time.Second {
			err = errors.New("disable waited for active query")
		}
		disabled <- err
	})
	defer timer.Stop()
	started := time.Now()
	if _, _, err := database.QueryContext(t.Context(), "SELECT sleep_ms(2000)"); err == nil || time.Since(started) > time.Second {
		t.Fatal("active SDK query survived disable")
	}
	select {
	case err := <-disabled:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("disable did not settle")
	}
}

func buildPluginDatabaseSDKFixture(t *testing.T) (string, plugin.Manifest) {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", "examples", "plugins"))
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := os.ReadFile(filepath.Join(root, "read-only-database", "gonavi.plugin.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest plugin.Manifest
	if err := json.Unmarshal(encoded, &manifest); err != nil {
		t.Fatal(err)
	}
	source := t.TempDir()
	binary := "plugin"
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	if err := os.Mkdir(filepath.Join(source, "bin"), 0700); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(source, "bin", binary)
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, "go", "-C", root, "build", "-o", executable, "./read-only-database")
	command.Env = append(os.Environ(), "GOWORK=off")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("build independent SDK fixture: %v\n%s", err, output)
	}
	manifest.Backend.Default.Executable = "bin/" + binary
	encoded, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), encoded, 0600); err != nil {
		t.Fatal(err)
	}
	return source, manifest
}

func waitPluginDatabaseRuntime(t *testing.T, manager *plugin.Manager, id string, state plugin.State) plugin.Status {
	t.Helper()
	timer := time.NewTimer(8 * time.Second)
	defer timer.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		for _, status := range manager.List() {
			if status.Manifest.ID == id && status.State == state {
				return status
			}
		}
		select {
		case <-timer.C:
			t.Fatalf("plugin runtime did not reach %s", state)
		case <-ticker.C:
		}
	}
}

func openRealPluginDatabase(t *testing.T, manager *plugin.Manager, status plugin.Status) *PluginDatabase {
	t.Helper()
	source := status.Manifest.Contributes.DataSources[0]
	database, err := NewPluginDatabase(manager, status, source, func(query string) error {
		if !strings.HasPrefix(query, "SELECT ") {
			return ErrPluginDatabaseReadOnly
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Errorf("close adapter: %v; cause=%T %v", err, errors.Unwrap(err), errors.Unwrap(err))
		}
	})
	if err := database.ConnectContext(t.Context(), connection.ConnectionConfig{Type: plugin.DataSourceType(status.Manifest.ID, source), Host: "memory", Database: "fixture"}); err != nil {
		t.Fatal(err)
	}
	return database
}

func verifyPluginDatabaseSDKMetadata(t *testing.T, database *PluginDatabase) {
	t.Helper()
	if err := database.PingContext(t.Context()); err != nil {
		t.Fatal(err)
	}
	if names, err := database.GetDatabases(); err != nil || len(names) != 1 || names[0] != "fixture" {
		t.Fatalf("SDK databases=%v error=%v", names, err)
	}
	if names, err := database.GetTables("fixture"); err != nil || len(names) != 1 || names[0] != "people" {
		t.Fatalf("SDK tables=%v error=%v", names, err)
	}
	if columns, err := database.GetColumnsContext(t.Context(), "fixture", "people"); err != nil || len(columns) != 3 {
		t.Fatalf("SDK columns=%v error=%v", columns, err)
	}
	if columns, err := database.GetAllColumns("fixture"); err != nil || len(columns) != 3 {
		t.Fatalf("SDK allColumns=%v error=%v", columns, err)
	}
	if indexes, err := database.GetIndexes("fixture", "people"); err != nil || len(indexes) != 1 {
		t.Fatalf("SDK indexes=%v error=%v", indexes, err)
	}
	if keys, err := database.GetForeignKeys("fixture", "people"); err != nil || len(keys) != 0 {
		t.Fatalf("SDK foreignKeys=%v error=%v", keys, err)
	}
	if triggers, err := database.GetTriggers("fixture", "people"); err != nil || len(triggers) != 0 {
		t.Fatalf("SDK triggers=%v error=%v", triggers, err)
	}
	if statement, err := database.GetCreateStatement("fixture", "people"); err != nil || statement == "" {
		t.Fatalf("SDK statement error=%v", err)
	}
}
