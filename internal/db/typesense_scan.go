//go:build gonavi_full_drivers || gonavi_typesense_driver

package db

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"net/http"
	"time"
)

// typesenseScanEntry 缓存最近一次客户端扫描的结果：数据网格翻页与计数会对同一条件连续发多次查询。
// 经本连接写入、集合文档数变化或超过 typesenseScanTTL 后失效。
type typesenseScanEntry struct {
	collection string
	key        string
	documents  int64
	matched    []map[string]interface{}
	loadedAt   time.Time
}

// scan 读出整个集合（见 visitDocuments），在客户端按条件筛选并排序；文档数超过 typesenseScanLimit 时拒绝。
func (t *TypesenseDB) scan(ctx context.Context, meta *typesenseCollectionMeta, where interface{}, keys []documentSortKey) ([]map[string]interface{}, error) {
	cacheKey := fmt.Sprintf("%#v|%#v", where, keys)
	t.mu.Lock()
	if entry := t.scanCache; entry != nil && entry.collection == meta.name && entry.key == cacheKey && entry.documents == meta.documents &&
		time.Since(entry.loadedAt) < typesenseScanTTL {
		t.mu.Unlock()
		return entry.matched, nil
	}
	t.mu.Unlock()

	tooLarge := func(count int64) error {
		return localizedDatabaseRuntimeError("db.backend.error.typesense_scan_too_large", map[string]any{
			"collection": meta.name, "count": count, "limit": typesenseScanLimit,
		})
	}
	if meta.documents > typesenseScanLimit {
		return nil, tooLarge(meta.documents)
	}
	matched := make([]map[string]interface{}, 0)
	scanned := 0
	err := t.visitDocuments(ctx, meta.name, func(document map[string]interface{}) error {
		if scanned++; scanned > typesenseScanLimit {
			return tooLarge(int64(scanned))
		}
		if where == nil || evaluateDocumentWhere(where, document) {
			matched = append(matched, document)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sortDocuments(matched, keys)

	t.mu.Lock()
	t.scanCache = &typesenseScanEntry{collection: meta.name, key: cacheKey, documents: meta.documents, matched: matched, loadedAt: time.Now()}
	t.mu.Unlock()
	return matched, nil
}

// visitDocuments 用导出接口流式读出整个集合，逐个文档回调。0.24 之前导出较慢（2500 个文档约 3 秒），
// 但搜索接口按页读取在这些版本上不稳定（同序的文档跨页会重复或遗漏），只能用导出。
func (t *TypesenseDB) visitDocuments(ctx context.Context, collection string, visit func(map[string]interface{}) error) error {
	return t.exportDocuments(ctx, collection, visit)
}

// exportDocuments 流式读取导出接口（JSON Lines），逐个文档回调。
func (t *TypesenseDB) exportDocuments(ctx context.Context, collection string, visit func(map[string]interface{}) error) error {
	body, err := t.doStream(ctx, http.MethodGet, typesenseCollectionPath(collection, "/documents/export"))
	if err != nil {
		return err
	}
	defer body.Close()
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 64*1024), maxRemoteJSONResponseBytes)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var document map[string]interface{}
		if err := decodeJSONWithUseNumber(line, &document); err != nil {
			return err
		}
		if err := visit(document); err != nil {
			return err
		}
	}
	return scanner.Err()
}
