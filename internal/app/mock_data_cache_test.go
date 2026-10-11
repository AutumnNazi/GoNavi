package app

import (
	"fmt"
	"testing"
	"time"

	"GoNavi-Wails/internal/mockdata"
)

func TestMockDataTableCacheExpiresEvictsAndDropsConnection(t *testing.T) {
	var cache mockDataTableCache
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	table := &mockDataTable{dbInst: &issue1025CapturingImportDB{}, dbType: "mysql", family: mockdata.FamilyMySQL}

	cache.put("k", table, now)
	got, ok := cache.get("k", now.Add(time.Minute))
	if !ok || got.dbType != "mysql" {
		t.Fatalf("fresh entry should be reused: %v %v", got, ok)
	}
	if got.dbInst != nil {
		t.Fatal("cached snapshot must not hold the database instance")
	}
	if _, ok := cache.get("k", now.Add(mockDataTableCacheTTL+time.Second)); ok {
		t.Fatal("expired entry should be reloaded")
	}

	cache.drop("k")
	if _, ok := cache.get("k", now); ok {
		t.Fatal("dropped entry should be gone")
	}

	for i := 0; i < mockDataTableCacheLimit+1; i++ {
		cache.put(fmt.Sprintf("t%d", i), table, now.Add(time.Duration(i)*time.Second))
	}
	if _, ok := cache.get("t0", now.Add(30*time.Second)); ok {
		t.Fatal("oldest entry should be evicted beyond the limit")
	}
	if _, ok := cache.get(fmt.Sprintf("t%d", mockDataTableCacheLimit), now.Add(30*time.Second)); !ok {
		t.Fatal("newest entry should stay")
	}
}
