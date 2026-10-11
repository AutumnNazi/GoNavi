package app

import (
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/connection"
)

// mockDataTableCacheTTL 是读表结果的复用时长：够用户调完规则多次预览，又不会长期拿着过期的父表取值。
const mockDataTableCacheTTL = 2 * time.Minute

// mockDataTableCacheLimit 限制缓存的表数，超出时淘汰最早读取的一张。
const mockDataTableCacheLimit = 16

// mockDataTableCache 缓存模拟数据的读表结果，供预览复用。
// 读表要查列、索引、外键并采样父表，远端或 SSH 转发下要几秒；预览只做计算，不必每次重查。
// 写入始终重新读表，写完清掉对应条目，保证约束与父表取值是最新的。
type mockDataTableCache struct {
	mu      sync.Mutex
	entries map[string]mockDataTableCacheEntry
}

type mockDataTableCacheEntry struct {
	table    *mockDataTable
	loadedAt time.Time
}

func mockDataTableCacheKey(config connection.ConnectionConfig, dbName, tableName string) string {
	return strings.Join([]string{getCacheKey(normalizeRunConfig(config, dbName)), dbName, tableName}, "\x00")
}

func (c *mockDataTableCache) get(key string, now time.Time) (*mockDataTable, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok || now.Sub(entry.loadedAt) > mockDataTableCacheTTL {
		return nil, false
	}
	return entry.table, true
}

// put 存的是不带数据库实例的副本：缓存只给预览计算用，不持有连接。
func (c *mockDataTableCache) put(key string, table *mockDataTable, now time.Time) {
	snapshot := *table
	snapshot.dbInst = nil
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = make(map[string]mockDataTableCacheEntry)
	}
	if _, exists := c.entries[key]; !exists && len(c.entries) >= mockDataTableCacheLimit {
		c.evictOldestLocked()
	}
	c.entries[key] = mockDataTableCacheEntry{table: &snapshot, loadedAt: now}
}

func (c *mockDataTableCache) drop(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, key)
}

func (c *mockDataTableCache) evictOldestLocked() {
	oldestKey := ""
	var oldest time.Time
	for key, entry := range c.entries {
		if oldestKey == "" || entry.loadedAt.Before(oldest) {
			oldestKey, oldest = key, entry.loadedAt
		}
	}
	delete(c.entries, oldestKey)
}
