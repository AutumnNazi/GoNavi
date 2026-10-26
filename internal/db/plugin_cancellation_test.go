package db

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestPluginDatabaseEveryOperationHonorsMetadataCancellation(t *testing.T) {
	operations := map[string]func(*PluginDatabase) error{
		"query":       func(p *PluginDatabase) error { _, _, err := p.Query("SELECT 1"); return err },
		"ping":        func(p *PluginDatabase) error { return p.Ping() },
		"databases":   func(p *PluginDatabase) error { _, err := p.GetDatabases(); return err },
		"tables":      func(p *PluginDatabase) error { _, err := p.GetTables("fixture"); return err },
		"create":      func(p *PluginDatabase) error { _, err := p.GetCreateStatement("fixture", "table"); return err },
		"columns":     func(p *PluginDatabase) error { _, err := p.GetColumns("fixture", "table"); return err },
		"allColumns":  func(p *PluginDatabase) error { _, err := p.GetAllColumns("fixture"); return err },
		"indexes":     func(p *PluginDatabase) error { _, err := p.GetIndexes("fixture", "table"); return err },
		"foreignKeys": func(p *PluginDatabase) error { _, err := p.GetForeignKeys("fixture", "table"); return err },
		"triggers":    func(p *PluginDatabase) error { _, err := p.GetTriggers("fixture", "table"); return err },
	}
	for name, operation := range operations {
		t.Run(name, func(t *testing.T) {
			database, runtime := connectedPluginDatabaseTest(t)
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			BindMetadataContext(database, ctx)
			defer ClearMetadataContext(database)
			if err := operation(database); !errors.Is(err, context.Canceled) {
				t.Fatalf("operation ignored cancellation: %v", err)
			}
			runtime.mu.Lock()
			count := len(runtime.calls)
			runtime.mu.Unlock()
			if count != 1 {
				t.Fatal("already-canceled request was dispatched")
			}
		})
	}
}

func TestPluginDatabaseConnectCancellationNeverReplays(t *testing.T) {
	database, runtime := newPluginDatabaseTest(t)
	entered := make(chan struct{})
	runtime.handler = func(ctx context.Context, request pluginDatabaseRequest) (json.RawMessage, error) {
		if request.Operation == "connect" {
			close(entered)
			<-ctx.Done()
			return nil, ctx.Err()
		}
		return pluginDatabaseTestReply(request.Operation), nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- database.ConnectContext(ctx, pluginDatabaseTestConfig(database)) }()
	waitPluginDatabaseSignal(t, entered)
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("connect cancellation=%v", err)
	}
	if err := database.ConnectContext(t.Context(), pluginDatabaseTestConfig(database)); err == nil {
		t.Fatal("uncertain connect replayed")
	}
	if len(runtime.requests("connect")) != 1 || len(runtime.requests("close")) != 1 {
		t.Fatal("connect cleanup pairing wrong")
	}
}

func TestPluginDatabasePendingCallsAreBounded(t *testing.T) {
	database, _ := connectedPluginDatabaseTest(t)
	releases := make([]func(), 0, pluginDatabaseMaxCalls)
	for range pluginDatabaseMaxCalls {
		_, release, err := database.beginCall(t.Context(), "query", false)
		if err != nil {
			t.Fatal(err)
		}
		releases = append(releases, release)
	}
	defer func() {
		for _, release := range releases {
			release()
		}
	}()
	if _, release, err := database.beginCall(t.Context(), "query", false); err == nil {
		release()
		t.Fatal("unbounded pending query admission")
	}
}

func TestPluginDatabaseExplicitContextsAndInterfaces(t *testing.T) {
	database, _ := connectedPluginDatabaseTest(t)
	if err := database.WaitClosed(nil); err == nil {
		t.Fatal("nil wait context accepted")
	}
	if err := database.PingContext(nil); err == nil {
		t.Fatal("nil ping context accepted")
	}
	if _, _, err := database.QueryContext(nil, "SELECT 1"); err == nil {
		t.Fatal("nil query context accepted")
	}
	if _, err := database.GetColumnsContext(nil, "fixture", "table"); err == nil {
		t.Fatal("nil column context accepted")
	}
	var driver Database = database
	if _, ok := driver.(BatchApplier); ok {
		t.Fatal("batch mutation interface advertised")
	}
	if _, err := driver.(ExecContexter).ExecContext(t.Context(), "DELETE FROM fixture"); !errors.Is(err, ErrPluginDatabaseReadOnly) {
		t.Fatalf("read-only write fence: %v", err)
	}
	if _, err := driver.(TransactionExecerProvider).OpenTransactionExecer(t.Context()); !errors.Is(err, ErrPluginDatabaseReadOnly) {
		t.Fatalf("read-only transaction fence: %v", err)
	}
}

func TestPluginDatabaseCloseFencesLateConnectCompletion(t *testing.T) {
	database, runtime := newPluginDatabaseTest(t)
	entered, release := make(chan struct{}), make(chan struct{})
	runtime.handler = func(_ context.Context, request pluginDatabaseRequest) (json.RawMessage, error) {
		if request.Operation == "connect" {
			close(entered)
			<-release
		}
		return pluginDatabaseTestReply(request.Operation), nil
	}
	// A single terminal result cannot strand the connect goroutine during cleanup.
	result := make(chan error, 1)
	go func() { result <- database.ConnectContext(t.Context(), pluginDatabaseTestConfig(database)) }()
	waitPluginDatabaseSignal(t, entered)
	if err := database.Close(); err != nil {
		close(release)
		t.Fatal(err)
	}
	close(release)
	if err := <-result; err == nil {
		t.Fatal("late connect resurrected closed session")
	}
	if database.IsCurrent() || len(runtime.requests("connect")) != 1 || len(runtime.requests("close")) != 1 {
		t.Fatal("late connect changed one-way lifecycle")
	}
}

func TestPluginDatabasePingContextCancelsInFlight(t *testing.T) {
	database, runtime := connectedPluginDatabaseTest(t)
	entered := make(chan struct{})
	runtime.handler = func(ctx context.Context, request pluginDatabaseRequest) (json.RawMessage, error) {
		if request.Operation == "ping" {
			close(entered)
			<-ctx.Done()
			return nil, ctx.Err()
		}
		return pluginDatabaseTestReply(request.Operation), nil
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	// One result is enough for the single cancellable ping.
	result := make(chan error, 1)
	go func() { result <- database.PingContext(ctx) }()
	waitPluginDatabaseSignal(t, entered)
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatal("ping ignored caller cancellation")
	}
}

func TestPluginDatabaseReadOnlyCallbackCannotBeBypassed(t *testing.T) {
	database, runtime := connectedPluginDatabaseTest(t)
	var observed string
	database.validateReadOnly = func(query string) error { observed = query; return ErrPluginDatabaseReadOnly }
	for _, query := range []string{"SELECT * INTO copied FROM fixture", "WITH changed AS (DELETE FROM fixture RETURNING *) SELECT * FROM changed", "  /* host policy sees original text */ SELECT 1;"} {
		if _, _, err := database.QueryContext(t.Context(), query); !errors.Is(err, ErrPluginDatabaseReadOnly) {
			t.Fatal("validator rejection ignored")
		}
		if observed != query {
			t.Fatal("query was rewritten before policy classification")
		}
	}
	if len(runtime.requests("query")) != 0 {
		t.Fatal("rejected query reached plugin")
	}
}
