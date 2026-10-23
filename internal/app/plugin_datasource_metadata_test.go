package app

import (
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
)

func TestPluginDataSourceMetadataCacheBypassesReadWriteAndCoalescing(t *testing.T) {
	a := &App{}
	config := connection.ConnectionConfig{Type: "plugin:test.reader:fixture:sqlite"}
	for _, kind := range []string{metadataCacheKindTables, metadataCacheKindAllColumns, metadataColumnCacheKind("fixture", "people")} {
		key := a.buildMetadataCacheKey(config, "fixture", kind)
		if !isPluginMetadataUncachedKey(key) {
			t.Fatal("plugin cache key lost its bypass marker")
		}
		a.metadataCacheSet(key, "must-not-persist")
		if _, hit := a.metadataCacheGet(key); hit {
			t.Fatal("plugin metadata write persisted")
		}
		// Even an old/injected entry must not be read through the common fetch path.
		store := a.metadataStore()
		store.mu.Lock()
		store.entries[key] = metadataCacheEntry{value: "stale", fetchedAt: time.Now()}
		store.mu.Unlock()
		calls := 0
		for i := 0; i < 2; i++ {
			value, err := a.metadataCacheFetch(key, func() (any, error) { calls++; return "fresh", nil })
			if err != nil || value != "fresh" {
				t.Fatalf("plugin metadata used cached bytes: %v %v", value, err)
			}
		}
		if calls != 2 {
			t.Fatal("plugin metadata was retained across reads")
		}
	}
}

func TestPluginDataSourceMetadataRequestsDoNotShareOldFlight(t *testing.T) {
	a := &App{}
	key := a.buildMetadataCacheKey(connection.ConnectionConfig{Type: "plugin:test.reader:fixture:sqlite"}, "fixture", metadataCacheKindTables)
	started, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	first := make(chan interface{}, 1)
	go func() {
		value, _ := a.metadataCacheFetch(key, func() (interface{}, error) { close(started); <-release; return "old-flight", nil })
		first <- value
	}()
	<-started
	second := make(chan interface{}, 1)
	go func() {
		value, _ := a.metadataCacheFetch(key, func() (interface{}, error) { return "fresh-flight", nil })
		second <- value
	}()
	select {
	case value := <-second:
		if value != "fresh-flight" {
			t.Fatalf("second request reused prior flight: %v", value)
		}
	case <-time.After(time.Second):
		t.Fatal("second request blocked on another generation's metadata flight")
	}
}

func TestPluginDataSourceMetadataBypassKeepsBuiltinCache(t *testing.T) {
	a := &App{}
	key := a.buildMetadataCacheKey(connection.ConnectionConfig{Type: "mysql", Host: "localhost"}, "app", metadataCacheKindTables)
	if isPluginMetadataUncachedKey(key) {
		t.Fatal("builtin metadata was marked uncached")
	}
	calls := 0
	for i := 0; i < 2; i++ {
		if _, err := a.metadataCacheFetch(key, func() (any, error) { calls++; return "builtin", nil }); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 1 {
		t.Fatalf("builtin metadata cache changed: fetch calls=%d", calls)
	}
}
