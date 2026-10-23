package db

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginDatabaseConstructorRejectsUntrustedDeclarations(t *testing.T) {
	status := pluginDatabaseTestStatus()
	source := status.Manifest.Contributes.DataSources[0]
	if _, err := NewPluginDatabase(nil, status, source, func(string) error { return nil }); !errors.Is(err, ErrPluginDatabaseUnavailable) {
		t.Fatal("nil manager accepted")
	}
	mutations := map[string]func(*plugin.Status){
		"disabled":   func(s *plugin.Status) { s.DesiredEnabled = false },
		"starting":   func(s *plugin.Status) { s.State = plugin.StateStarting },
		"permission": func(s *plugin.Status) { s.Manifest.Permissions = nil },
		"backend":    func(s *plugin.Status) { s.Manifest.Backend = nil },
		"command":    func(s *plugin.Status) { s.Manifest.Contributes.Commands = nil },
		"source":     func(s *plugin.Status) { s.Manifest.Contributes.DataSources = nil },
		"generation": func(s *plugin.Status) { s.Generation = 0 },
		"digest":     func(s *plugin.Status) { s.Digest = "" },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			s := pluginDatabaseTestStatus()
			mutate(&s)
			runtime := &pluginDatabaseFake{status: s}
			if _, err := newPluginDatabase(runtime, s, source, func(string) error { return nil }); err == nil {
				t.Fatal("invalid declaration accepted")
			}
		})
	}
	runtime := &pluginDatabaseFake{status: status}
	if _, err := newPluginDatabase(runtime, status, source, nil); !errors.Is(err, ErrPluginDatabaseReadOnly) {
		t.Fatal("missing SQL validator accepted")
	}
	forged := source
	forged.Command = "other"
	if _, err := newPluginDatabase(runtime, status, forged, func(string) error { return nil }); err == nil {
		t.Fatal("forged source accepted")
	}
	stale := status
	stale.Generation++
	if _, err := newPluginDatabase(runtime, stale, source, func(string) error { return nil }); err == nil {
		t.Fatal("stale constructor snapshot accepted")
	}
}

func TestPluginDatabaseSessionScopeReadOnlyAndLosslessNumbers(t *testing.T) {
	database, runtime := connectedPluginDatabaseTest(t)
	runtime.handler = func(_ context.Context, request pluginDatabaseRequest) (json.RawMessage, error) {
		if request.Operation == "query" {
			return json.RawMessage(`{"rows":[{"big":9007199254740993,"decimal":0.1234567890123456789}],"fields":["big","decimal"]}`), nil
		}
		return pluginDatabaseTestReply(request.Operation), nil
	}
	rows, fields, err := database.QueryContext(t.Context(), "SELECT 1")
	if err != nil || len(rows) != 1 || len(fields) != 2 {
		t.Fatalf("query failed: %v", err)
	}
	if rows[0]["big"] != "9007199254740993" || rows[0]["decimal"] != "0.1234567890123456789" {
		t.Fatal("numeric precision was lost")
	}
	for _, query := range []string{"DELETE FROM fixture", "WITH removed AS (DELETE FROM fixture RETURNING *) SELECT * FROM removed"} {
		if _, _, err := database.QueryContext(t.Context(), query); err == nil {
			t.Fatal("host SQL validator bypassed")
		}
	}
	if _, err := database.Exec("SELECT 1"); !errors.Is(err, ErrPluginDatabaseReadOnly) {
		t.Fatal("Exec allowed")
	}
	if len(runtime.requests("query")) != 1 {
		t.Fatal("rejected SQL reached plugin")
	}
	for _, call := range append(runtime.requests("connect"), runtime.requests("query")...) {
		if call.id != runtime.status.Manifest.ID || call.generation != 7 || call.sourceID != "readonly" || call.request.ProtocolVersion != 1 {
			t.Fatal("caller-controlled runtime scope")
		}
		if len(call.request.SessionID) != 43 || call.request.SessionID != database.sessionID {
			t.Fatal("session was not bound")
		}
	}
	other, _ := newPluginDatabaseTest(t)
	if other.sessionID == database.sessionID {
		t.Fatal("session ID reused")
	}
	if !database.IsCurrent() || database.PluginGeneration() != 7 {
		t.Fatal("freshness accessor failed")
	}
}

func TestPluginDatabaseGenerationAndInstallationAreFenced(t *testing.T) {
	for _, change := range []string{"generation", "disabled", "digest", "installed", "source"} {
		t.Run(change, func(t *testing.T) {
			database, runtime := connectedPluginDatabaseTest(t)
			runtime.mu.Lock()
			switch change {
			case "generation":
				runtime.status.Generation++
			case "disabled":
				runtime.status.DesiredEnabled = false
			case "digest":
				runtime.status.Digest = strings.Repeat("b", 64)
			case "installed":
				runtime.status.InstalledAt = "replacement"
			case "source":
				runtime.status.Manifest.Contributes.DataSources = nil
			}
			runtime.mu.Unlock()
			if database.IsCurrent() {
				t.Fatal("stale adapter considered current")
			}
			if _, _, err := database.QueryContext(t.Context(), "SELECT 1"); !errors.Is(err, ErrPluginDatabaseUnavailable) {
				t.Fatalf("stale query: %v", err)
			}
			if len(runtime.requests("query")) != 0 {
				t.Fatal("stale request dispatched")
			}
			if err := database.Close(); err != nil {
				t.Fatal(err)
			}
			if len(runtime.requests("close")) != 0 {
				t.Fatal("close was sent to replacement/disabled generation")
			}
		})
	}
}

func TestPluginDatabaseLateResponseDoesNotCrossGeneration(t *testing.T) {
	database, runtime := connectedPluginDatabaseTest(t)
	runtime.handler = func(_ context.Context, request pluginDatabaseRequest) (json.RawMessage, error) {
		runtime.mu.Lock()
		runtime.status.Generation++
		runtime.mu.Unlock()
		return pluginDatabaseTestReply(request.Operation), nil
	}
	rows, fields, err := database.QueryContext(t.Context(), "SELECT 1")
	if !errors.Is(err, ErrPluginDatabaseUnavailable) || rows != nil || fields != nil {
		t.Fatal("late reply leaked")
	}
	if len(runtime.requests("query")) != 1 {
		t.Fatal("query replayed")
	}
}

func TestPluginDatabaseCloseCancelsBeforeBoundedCleanup(t *testing.T) {
	database, runtime := connectedPluginDatabaseTest(t)
	entered := make(chan struct{})
	canceled := make(chan struct{})
	closing := make(chan struct{})
	runtime.handler = func(ctx context.Context, request pluginDatabaseRequest) (json.RawMessage, error) {
		switch request.Operation {
		case "query":
			close(entered)
			<-ctx.Done()
			close(canceled)
			return nil, ctx.Err()
		case "close":
			close(closing)
			<-ctx.Done()
			return nil, ctx.Err()
		default:
			return pluginDatabaseTestReply(request.Operation), nil
		}
	}
	result := make(chan error, 1)
	go func() { _, _, err := database.QueryContext(context.Background(), "SELECT 1"); result <- err }()
	waitPluginDatabaseSignal(t, entered)
	closed := make(chan error, 1)
	started := time.Now()
	go func() { closed <- database.Close() }()
	waitPluginDatabaseSignal(t, canceled)
	waitPluginDatabaseSignal(t, closing)
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := database.QueryContext(t.Context(), "SELECT 1"); !errors.Is(err, ErrPluginDatabaseClosed) {
		t.Fatal("query after close accepted")
	}
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("query cancellation=%v", err)
	}
	if err := <-closed; !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cleanup timeout=%v", err)
	}
	if time.Since(started) > time.Second {
		t.Fatal("cleanup exceeded bounded deadline")
	}
	if err := database.WaitClosed(t.Context()); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("cleanup outcome lost")
	}
	if len(runtime.requests("close")) != 1 {
		t.Fatal("close replayed")
	}
	if err := database.Connect(pluginDatabaseTestConfig(database)); err == nil {
		t.Fatal("closed session reconnected")
	}
}

func TestPluginDatabaseErrorsDoNotExposePluginDiagnostics(t *testing.T) {
	database, runtime := connectedPluginDatabaseTest(t)
	secret := errors.New("password=selected-password SQL=secret")
	runtime.handler = func(_ context.Context, request pluginDatabaseRequest) (json.RawMessage, error) {
		if request.Operation == "query" {
			return nil, secret
		}
		return pluginDatabaseTestReply(request.Operation), nil
	}
	_, _, err := database.QueryContext(t.Context(), "SELECT 1")
	if !errors.Is(err, secret) || strings.Contains(err.Error(), "selected-password") {
		t.Fatal("plugin diagnostic leaked or cause lost")
	}
}
