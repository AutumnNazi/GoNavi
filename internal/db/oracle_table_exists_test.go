package db

import (
	"database/sql/driver"
	"strings"
	"testing"
)

// 回归 refs #1441：SQL 导航等调用方传入的 Oracle 表名是 GetTables 的 OWNER.TABLE
// 全名形态，点查必须拆分限定名、按裸 TABLE_NAME 查字典，否则对真实存在的表恒判
// 不存在，误报「表已不存在」。
func TestOracleTableExistsSplitsQualifiedOwnerTableTarget(t *testing.T) {
	t.Parallel()

	dbConn, state := openOracleRecordingDB(t)
	state.mu.Lock()
	state.queryResults[buildOracleTableExistsQuery("MYCIMLED", "T_ADS")] = oracleRecordingQueryResult{
		columns: []string{"TABLE_NAME"},
		rows:    [][]driver.Value{{"T_ADS"}},
	}
	state.mu.Unlock()

	oracleDB := &OracleDB{conn: dbConn}
	exists, err := oracleDB.TableExists("MYCIMLED", "MYCIMLED.T_ADS")
	if err != nil {
		t.Fatalf("TableExists 返回错误: %v", err)
	}
	if !exists {
		t.Fatalf("限定名目标应命中裸名字典，实际 exists=false，查询: %v", state.snapshotQueries())
	}
	// 字面断言防 builder 回归：stub key 复用被测代码构造，builder 自身写错时仍会通过，
	// 这里直接锁定查询文本必须按裸表名查 all_tables。
	assertLastQueryContains(t, state, "FROM all_tables", "owner = 'MYCIMLED'", "table_name = 'T_ADS'")
}

func TestOracleTableExistsKeepsBareNameTarget(t *testing.T) {
	t.Parallel()

	dbConn, state := openOracleRecordingDB(t)
	state.mu.Lock()
	state.queryResults[buildOracleTableExistsQuery("MYCIMLED", "T_ADS")] = oracleRecordingQueryResult{
		columns: []string{"TABLE_NAME"},
		rows:    [][]driver.Value{{"T_ADS"}},
	}
	state.mu.Unlock()

	oracleDB := &OracleDB{conn: dbConn}
	exists, err := oracleDB.TableExists("MYCIMLED", "T_ADS")
	if err != nil {
		t.Fatalf("TableExists 返回错误: %v", err)
	}
	if !exists {
		t.Fatalf("裸表名目标应保持原有行为，实际 exists=false，查询: %v", state.snapshotQueries())
	}
	assertLastQueryContains(t, state, "FROM all_tables", "table_name = 'T_ADS'")
}

// 跨 schema 引用：限定名里自带的 owner 比调用方给定的 dbName 更可信。
func TestOracleTableExistsPrefersOwnerFromQualifiedTarget(t *testing.T) {
	t.Parallel()

	dbConn, state := openOracleRecordingDB(t)
	state.mu.Lock()
	state.queryResults[buildOracleTableExistsQuery("MYCIMLED", "T_ADS")] = oracleRecordingQueryResult{
		columns: []string{"TABLE_NAME"},
		rows:    [][]driver.Value{{"T_ADS"}},
	}
	state.mu.Unlock()

	oracleDB := &OracleDB{conn: dbConn}
	exists, err := oracleDB.TableExists("HR", "MYCIMLED.T_ADS")
	if err != nil {
		t.Fatalf("TableExists 返回错误: %v", err)
	}
	if !exists {
		t.Fatalf("应按目标自带的 owner 查询，实际 exists=false，查询: %v", state.snapshotQueries())
	}
	assertLastQueryContains(t, state, "owner = 'MYCIMLED'")
}

// 引号内的点号是对象名的一部分，不是限定符：整名应原样进入 table_name 比较。
func TestOracleTableExistsKeepsQuotedDottedTableLiteral(t *testing.T) {
	t.Parallel()

	dbConn, state := openOracleRecordingDB(t)
	state.mu.Lock()
	state.queryResults[buildOracleTableExistsQuery("MYCIMLED", "ORDER.ITEMS")] = oracleRecordingQueryResult{
		columns: []string{"TABLE_NAME"},
		rows:    [][]driver.Value{{"ORDER.ITEMS"}},
	}
	state.mu.Unlock()

	oracleDB := &OracleDB{conn: dbConn}
	exists, err := oracleDB.TableExists("MYCIMLED", `MYCIMLED."ORDER.ITEMS"`)
	if err != nil {
		t.Fatalf("TableExists 返回错误: %v", err)
	}
	if !exists {
		t.Fatalf("引号点号表名应整名参与点查，实际 exists=false，查询: %v", state.snapshotQueries())
	}
	assertLastQueryContains(t, state, "table_name = 'ORDER.ITEMS'")
}

// 表确实不存在时应干净返回 (false, nil)：点查 miss 与查询失败是两回事，
// 错误会驱使调用方走「检查失败」分支而不是「确认缺失」。
func TestOracleTableExistsReturnsCleanFalseForMissingTable(t *testing.T) {
	t.Parallel()

	dbConn, _ := openOracleRecordingDB(t)

	oracleDB := &OracleDB{conn: dbConn}
	exists, err := oracleDB.TableExists("MYCIMLED", "MYCIMLED.T_MISSING")
	if err != nil {
		t.Fatalf("点查 miss 不应返回错误: %v", err)
	}
	if exists {
		t.Fatal("缺失表应返回 exists=false")
	}
}

// 大小写变体：小写输入应经候选循环命中大写字典，且命中变体被记住后二次调用不再重试。
func TestOracleTableExistsMatchesCaseVariantAndRemembersPair(t *testing.T) {
	t.Parallel()

	dbConn, state := openOracleRecordingDB(t)
	state.mu.Lock()
	state.queryResults[buildOracleTableExistsQuery("MYCIMLED", "T_ADS")] = oracleRecordingQueryResult{
		columns: []string{"TABLE_NAME"},
		rows:    [][]driver.Value{{"T_ADS"}},
	}
	state.mu.Unlock()

	oracleDB := &OracleDB{conn: dbConn}
	exists, err := oracleDB.TableExists("MYCIMLED", "MYCIMLED.t_ads")
	if err != nil {
		t.Fatalf("TableExists 返回错误: %v", err)
	}
	if !exists {
		t.Fatalf("小写限定名应经大小写候选命中，实际 exists=false，查询: %v", state.snapshotQueries())
	}
	assertLastQueryContains(t, state, "table_name = 'T_ADS'")

	if _, err := oracleDB.TableExists("MYCIMLED", "MYCIMLED.t_ads"); err != nil {
		t.Fatalf("二次 TableExists 返回错误: %v", err)
	}
	// 变体缓存只记住「命中的大小写变体」而不是存在性结果（表可能刚被创建），
	// 二次调用仍要点查一次，但应直接用记住的变体，不再重试原始小写候选。
	queries := state.snapshotQueries()
	if len(queries) != 3 {
		t.Fatalf("二次调用应只发一次记住变体的点查，查询数=%d: %v", len(queries), queries)
	}
	if !strings.Contains(queries[len(queries)-1], "table_name = 'T_ADS'") {
		t.Fatalf("二次调用应复用记住的变体，实际: %s", queries[len(queries)-1])
	}
	retriedRaw := 0
	for _, query := range queries {
		if strings.Contains(query, "table_name = 't_ads'") {
			retriedRaw++
		}
	}
	if retriedRaw != 1 {
		t.Fatalf("原始小写候选只应被尝试一次，实际 %d 次: %v", retriedRaw, queries)
	}
}

func assertLastQueryContains(t *testing.T, state *oracleRecordingState, fragments ...string) {
	t.Helper()
	queries := state.snapshotQueries()
	if len(queries) == 0 {
		t.Fatalf("未记录到任何查询")
	}
	last := queries[len(queries)-1]
	for _, fragment := range fragments {
		if !strings.Contains(last, fragment) {
			t.Fatalf("最后一次查询应包含 %q，实际: %s", fragment, last)
		}
	}
}
