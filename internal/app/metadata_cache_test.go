package app

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

func newMetadataCacheTestApp() *App {
	return &App{
		dbCache:         make(map[string]cachedDatabase),
		connectFailures: make(map[string]cachedConnectFailure),
		runningQueries:  make(map[string]queryContext),
		metadataCache:   newMetadataCacheStore(),
	}
}

func metadataTestConfig(host string) connection.ConnectionConfig {
	return connection.ConnectionConfig{Type: "mysql", Host: host, Port: 3306, User: "u", Database: "d"}
}

// ① 同 key 并发只打一次后端：singleflight 收敛 + 双检。
func TestMetadataCacheConcurrentFetchCollapsesToOneBackendCall(t *testing.T) {
	const callers = 32
	cases := []struct {
		name    string
		kind    string
		value   interface{}
		fetched func(calls *atomic.Int32) func() (interface{}, error)
	}{
		{
			name:  "tables",
			kind:  metadataCacheKindTables,
			value: []string{"t1", "t2"},
			fetched: func(calls *atomic.Int32) func() (interface{}, error) {
				return func() (interface{}, error) {
					calls.Add(1)
					time.Sleep(20 * time.Millisecond)
					return []string{"t1", "t2"}, nil
				}
			},
		},
		{
			name:  "allcols",
			kind:  metadataCacheKindAllColumns,
			value: []connection.ColumnDefinitionWithTable{{TableName: "t1", Name: "id"}},
			fetched: func(calls *atomic.Int32) func() (interface{}, error) {
				return func() (interface{}, error) {
					calls.Add(1)
					time.Sleep(20 * time.Millisecond)
					return []connection.ColumnDefinitionWithTable{{TableName: "t1", Name: "id"}}, nil
				}
			},
		},
		{
			name:  "columns",
			kind:  metadataColumnCacheKind("S1", "T"),
			value: []connection.ColumnDefinition{{Name: "id", Type: "bigint"}},
			fetched: func(calls *atomic.Int32) func() (interface{}, error) {
				return func() (interface{}, error) {
					calls.Add(1)
					time.Sleep(20 * time.Millisecond)
					return []connection.ColumnDefinition{{Name: "id", Type: "bigint"}}, nil
				}
			},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			app := newMetadataCacheTestApp()
			key := app.buildMetadataCacheKey(metadataTestConfig("singleflight-"+testCase.name), "app", testCase.kind)
			var calls atomic.Int32
			fetch := testCase.fetched(&calls)

			start := make(chan struct{})
			values := make([]interface{}, callers)
			errs := make([]error, callers)
			var workers sync.WaitGroup
			workers.Add(callers)
			for index := 0; index < callers; index++ {
				go func(slot int) {
					defer workers.Done()
					<-start
					values[slot], errs[slot] = app.metadataCacheFetch(key, fetch)
				}(index)
			}
			close(start)
			workers.Wait()

			if got := calls.Load(); got != 1 {
				t.Fatalf("并发请求未收敛为一次后端查询，后端调用次数=%d，期望 1", got)
			}
			for slot := 0; slot < callers; slot++ {
				if errs[slot] != nil {
					t.Fatalf("第 %d 个请求返回错误：%v", slot, errs[slot])
				}
				if values[slot] == nil {
					t.Fatalf("第 %d 个请求拿到空值", slot)
				}
			}
		})
	}
}

// ② TTL 过期后重新拉取；未过期时不重复拉取。
func TestMetadataCacheRefetchesOnlyAfterTTLExpiry(t *testing.T) {
	app := newMetadataCacheTestApp()
	key := app.buildMetadataCacheKey(metadataTestConfig("ttl"), "app", metadataCacheKindTables)
	var calls atomic.Int32
	fetch := func() (interface{}, error) {
		calls.Add(1)
		return []string{"t1"}, nil
	}

	if _, err := app.metadataCacheFetch(key, fetch); err != nil {
		t.Fatalf("首次拉取失败：%v", err)
	}
	if _, err := app.metadataCacheFetch(key, fetch); err != nil {
		t.Fatalf("缓存命中拉取失败：%v", err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("TTL 未过期却重复拉取，后端调用次数=%d，期望 1", got)
	}

	// 直接操纵底层条目把 fetchedAt 推到 TTL 之前，避免真的等 45s。
	store := app.metadataCache
	store.mu.Lock()
	entry, ok := store.entries[key]
	if !ok {
		store.mu.Unlock()
		t.Fatalf("缓存中没有 key=%q 的条目", key)
	}
	entry.fetchedAt = time.Now().Add(-(metadataCacheTTL + time.Second))
	store.entries[key] = entry
	store.mu.Unlock()

	if _, err := app.metadataCacheFetch(key, fetch); err != nil {
		t.Fatalf("过期后拉取失败：%v", err)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("TTL 过期后未重新拉取，后端调用次数=%d，期望 2", got)
	}
}

// ③ invalidateMetadata 按 <连接key>\x00<库名>\x00 前缀清空：同库全清，他库与他连接不动。
func TestMetadataCacheInvalidateDropsOnlyMatchingPrefix(t *testing.T) {
	app := newMetadataCacheTestApp()
	config := metadataTestConfig("invalidate")
	otherConfig := metadataTestConfig("invalidate-other")

	type target struct {
		config connection.ConnectionConfig
		dbName string
		kind   string
		value  string
	}
	targets := []target{
		{config, "app", metadataCacheKindTables, "app-tables"},
		{config, "app", metadataCacheKindAllColumns, "app-allcols"},
		{config, "app", metadataColumnCacheKind("S1", "T"), "app-s1t"},
		{config, "report", metadataCacheKindTables, "report-tables"},
		{otherConfig, "app", metadataCacheKindTables, "other-app-tables"},
	}

	seed := func(item target) string {
		// 与生产一致：缓存键由归一化后的运行配置派生（网络库会把 Database 改写成 dbName）。
		key := app.buildMetadataCacheKey(normalizeMetadataRunConfig(item.config, item.dbName), item.dbName, item.kind)
		app.metadataCacheSet(key, item.value)
		return key
	}
	keys := make([]string, 0, len(targets))
	for _, item := range targets {
		keys = append(keys, seed(item))
	}

	app.invalidateMetadata(normalizeMetadataRunConfig(config, "app"), "app")

	// 前 3 个（同连接同库）应被清空；后 2 个必须保留。
	for index := 0; index < 3; index++ {
		if value, ok := app.metadataCacheGet(keys[index]); ok {
			t.Fatalf("同库缓存未被清空：key=%q value=%v", keys[index], value)
		}
	}
	for index := 3; index < len(keys); index++ {
		value, ok := app.metadataCacheGet(keys[index])
		if !ok {
			t.Fatalf("不该被清空的缓存被删了：key=%q", keys[index])
		}
		if value != targets[index].value {
			t.Fatalf("缓存值被改动：key=%q got=%v want=%v", keys[index], value, targets[index].value)
		}
	}
}

// ④ 不同库 / 不同表 / 不同 kind 互不串键（含 Oracle 同库不同 schema 同名表）。
func TestMetadataCacheKeysAreIsolatedAcrossScope(t *testing.T) {
	app := newMetadataCacheTestApp()
	config := metadataTestConfig("isolate")
	runConfig := normalizeMetadataRunConfig(config, "app")

	cases := []struct {
		name   string
		dbName string
		kind   string
	}{
		{name: "db-app-tables", dbName: "app", kind: metadataCacheKindTables},
		{name: "db-report-tables", dbName: "report", kind: metadataCacheKindTables},
		{name: "db-app-allcols", dbName: "app", kind: metadataCacheKindAllColumns},
		{name: "schema-s1", dbName: "app", kind: metadataColumnCacheKind("S1", "T")},
		{name: "schema-s2", dbName: "app", kind: metadataColumnCacheKind("S2", "T")},
		{name: "schema-s1-other-table", dbName: "app", kind: metadataColumnCacheKind("S1", "T2")},
	}
	seen := make(map[string]string, len(cases))
	for _, testCase := range cases {
		key := app.buildMetadataCacheKey(runConfig, testCase.dbName, testCase.kind)
		if previous, exists := seen[key]; exists {
			t.Fatalf("键冲突：%s 与 %s 生成了同一个 key", previous, testCase.name)
		}
		seen[key] = testCase.name
		app.metadataCacheSet(key, testCase.name)
	}

	for _, testCase := range cases {
		key := app.buildMetadataCacheKey(runConfig, testCase.dbName, testCase.kind)
		value, ok := app.metadataCacheGet(key)
		if !ok {
			t.Fatalf("%s 的缓存丢失", testCase.name)
		}
		if value != testCase.name {
			t.Fatalf("%s 读到了别的条目：%v", testCase.name, value)
		}
	}
}

// 错误不落缓存：失败后下一次请求必须重新打后端。
func TestMetadataCacheDoesNotCacheFailures(t *testing.T) {
	app := newMetadataCacheTestApp()
	key := app.buildMetadataCacheKey(metadataTestConfig("failure"), "app", metadataCacheKindTables)
	var calls atomic.Int32
	wantErr := errors.New("metadata permission denied")
	fetch := func() (interface{}, error) {
		calls.Add(1)
		return nil, wantErr
	}

	for attempt := 0; attempt < 2; attempt++ {
		if _, err := app.metadataCacheFetch(key, fetch); !errors.Is(err, wantErr) {
			t.Fatalf("第 %d 次请求的错误未透传：%v", attempt, err)
		}
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("失败结果被缓存了，后端调用次数=%d，期望 2", got)
	}
}

// 取消中的请求不得写入缓存：驱动可能只取到部分元数据，写进去会让后续正常请求
// 在 45s 内读到不完整结果。
func TestMetadataCacheSkipsWriteWhenRequestCancelled(t *testing.T) {
	app := newMetadataCacheTestApp()
	key := app.buildMetadataCacheKey(metadataTestConfig("cancelled"), "app", metadataCacheKindTables)

	ctx, cancel := context.WithCancel(context.Background())
	app.metadataSession = &metadataSession{app: app, ctx: ctx, synchronous: true}
	defer func() { app.metadataSession = nil }()

	var calls atomic.Int32
	fetch := func() (interface{}, error) {
		calls.Add(1)
		cancel()
		return []string{"partial"}, nil
	}

	value, err := app.metadataCacheFetch(key, fetch)
	if err != nil {
		t.Fatalf("取消的请求仍应把已取到的值返回调用方：%v", err)
	}
	if value == nil {
		t.Fatal("取消的请求丢了已取到的值")
	}
	if _, ok := app.metadataCacheGet(key); ok {
		t.Fatal("取消的请求把元数据写进了缓存")
	}

	// 下一次请求已不带取消状态：必须重新打后端，且缓存里只能是它的结果。
	app.metadataSession = nil
	if _, err := app.metadataCacheFetch(key, func() (interface{}, error) {
		calls.Add(1)
		return []string{"complete"}, nil
	}); err != nil {
		t.Fatalf("取消后的下一次请求失败：%v", err)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("取消的请求污染了缓存，后端调用次数=%d，期望 2", got)
	}
	cached, ok := app.metadataCacheGet(key)
	if !ok {
		t.Fatal("第二次请求的结果未落缓存")
	}
	tables, _ := cached.([]string)
	if len(tables) != 1 || tables[0] != "complete" {
		t.Fatalf("缓存里是第一次（已取消）请求的部分结果：%v", cached)
	}
}

// 缓存值是不可变副本语义：调用方拿到的是副本，改动它不应影响后续命中。
func TestMetadataCacheStoresDetachedCopy(t *testing.T) {
	app := newMetadataCacheTestApp()
	key := app.buildMetadataCacheKey(metadataTestConfig("immutable"), "app", metadataCacheKindTables)

	source := []string{"t1", "t2"}
	if _, err := app.metadataCacheFetch(key, func() (interface{}, error) {
		return append([]string(nil), source...), nil
	}); err != nil {
		t.Fatalf("首次拉取失败：%v", err)
	}

	source[0] = "mutated"
	value, ok := app.metadataCacheGet(key)
	if !ok {
		t.Fatal("缓存丢失")
	}
	tables, _ := value.([]string)
	if tables[0] != "t1" {
		t.Fatalf("缓存值被外部切片改写：%v", tables)
	}
}

// 连接被释放时按 config 前缀清空该连接所有库的元数据（重连后不残留旧结构）。
func TestMetadataCacheDropForConfigClearsEveryDatabase(t *testing.T) {
	app := newMetadataCacheTestApp()
	config := metadataTestConfig("drop-config")
	otherConfig := metadataTestConfig("drop-config-other")
	runConfig := normalizeMetadataRunConfig(config, "app")

	keys := []string{
		app.buildMetadataCacheKey(runConfig, "app", metadataCacheKindTables),
		app.buildMetadataCacheKey(runConfig, "report", metadataCacheKindAllColumns),
		app.buildMetadataCacheKey(runConfig, "app", metadataColumnCacheKind("S1", "T")),
	}
	for _, key := range keys {
		app.metadataCacheSet(key, "value")
	}
	otherKey := app.buildMetadataCacheKey(normalizeMetadataRunConfig(otherConfig, "app"), "app", metadataCacheKindTables)
	app.metadataCacheSet(otherKey, "other")

	app.dropMetadataCacheForConfig(getCacheKey(runConfig))

	for _, key := range keys {
		if _, ok := app.metadataCacheGet(key); ok {
			t.Fatalf("该连接的元数据未清空：key=%q", key)
		}
	}
	if _, ok := app.metadataCacheGet(otherKey); !ok {
		t.Fatal("清空时误删了其它连接的元数据")
	}
}

// ⑤ lane：元数据通道与查询通道各自持有一个物理连接，且连续调用复用而不是每次新建。
//
// 这是上一轮中止点的回归护栏：当时只把后缀传进 singleflight key、落库时却重算
// getCacheKey 丢掉后缀，表现为「每次元数据调用都真做一次物理建连再立刻丢弃」，
// dbCache 里永远只有无后缀记录，通道完全失效且比不改更差。
func TestMetadataLaneHoldsIndependentPhysicalConnection(t *testing.T) {
	installDatabaseCacheConcurrencyTestHooks(t)

	var factoryCalls atomic.Int32
	var connectCalls atomic.Int32
	newDatabaseFunc = func(string) (db.Database, error) {
		factoryCalls.Add(1)
		return &cacheConcurrencyDB{
			connect: func(connection.ConnectionConfig) error {
				connectCalls.Add(1)
				return nil
			},
		}, nil
	}

	app := newDatabaseCacheConcurrencyTestApp()
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "lane"}

	metadataInst, err := app.getMetadataDatabase(config)
	if err != nil {
		t.Fatalf("元数据通道取连接失败：%v", err)
	}
	queryInst, err := app.getDatabase(config)
	if err != nil {
		t.Fatalf("查询通道取连接失败：%v", err)
	}
	if metadataInst == queryInst {
		t.Fatal("元数据通道与查询通道共用了同一个物理连接，通道隔离失效")
	}

	for attempt := 0; attempt < 5; attempt++ {
		again, loopErr := app.getMetadataDatabase(config)
		if loopErr != nil {
			t.Fatalf("第 %d 次元数据取连接失败：%v", attempt, loopErr)
		}
		if again != metadataInst {
			t.Fatalf("第 %d 次元数据调用新建了物理连接：通道后缀在落库时被丢掉了", attempt)
		}
		if cached, loopErr := app.getDatabase(config); loopErr != nil || cached != queryInst {
			t.Fatalf("第 %d 次查询取连接没有复用缓存连接：err=%v", attempt, loopErr)
		}
	}

	// 两条通道各一次建连，之后全命中缓存。
	if got := factoryCalls.Load(); got != 2 {
		t.Fatalf("驱动实例创建次数=%d，期望 2（每通道 1 次）", got)
	}
	if got := connectCalls.Load(); got != 2 {
		t.Fatalf("物理建连次数=%d，期望 2（每通道 1 次）", got)
	}

	app.mu.RLock()
	cached := len(app.dbCache)
	app.mu.RUnlock()
	if cached != 2 {
		t.Fatalf("dbCache 条目数=%d，期望 2（两条通道各一条，后缀已参与落库 key）", cached)
	}
}

// 元数据通道失效不得影响查询通道：否则元数据查询报「连接已断开」会误杀用户正在用的连接。
func TestInvalidateMetadataDatabaseLeavesQueryLaneIntact(t *testing.T) {
	installDatabaseCacheConcurrencyTestHooks(t)

	var connectCalls atomic.Int32
	newDatabaseFunc = func(string) (db.Database, error) {
		return &cacheConcurrencyDB{
			connect: func(connection.ConnectionConfig) error {
				connectCalls.Add(1)
				return nil
			},
		}, nil
	}

	app := newDatabaseCacheConcurrencyTestApp()
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "lane-invalidate"}

	metadataInst, err := app.getMetadataDatabase(config)
	if err != nil {
		t.Fatalf("元数据通道取连接失败：%v", err)
	}
	queryInst, err := app.getDatabase(config)
	if err != nil {
		t.Fatalf("查询通道取连接失败：%v", err)
	}

	if !app.invalidateMetadataDatabase(config, errors.New("metadata connection lost")) {
		t.Fatal("元数据通道失效没有命中缓存条目")
	}

	if cached, cachedErr := app.getDatabase(config); cachedErr != nil || cached != queryInst {
		t.Fatalf("元数据通道失效把查询通道一起干掉了：err=%v", cachedErr)
	}
	if got := connectCalls.Load(); got != 2 {
		t.Fatalf("物理建连次数=%d，期望 2（查询通道不应重建）", got)
	}

	// 元数据通道下一次取必须重建，且是新的物理连接。
	rebuilt, err := app.getMetadataDatabase(config)
	if err != nil {
		t.Fatalf("元数据通道重建失败：%v", err)
	}
	if rebuilt == metadataInst {
		t.Fatal("元数据通道失效后仍返回了已关闭的旧连接")
	}
	if got := connectCalls.Load(); got != 3 {
		t.Fatalf("物理建连次数=%d，期望 3（元数据通道重建 1 次）", got)
	}
}

// 元数据通道冷建连不得阻塞查询通道：这是拆通道的收益本体。
func TestMetadataLaneColdConnectDoesNotBlockQueryLane(t *testing.T) {
	installDatabaseCacheConcurrencyTestHooks(t)

	metadataConnectStarted := make(chan struct{})
	releaseMetadataConnect := make(chan struct{})
	var startOnce sync.Once
	var mu sync.Mutex
	created := 0
	newDatabaseFunc = func(string) (db.Database, error) {
		mu.Lock()
		created++
		index := created
		mu.Unlock()
		return &cacheConcurrencyDB{
			connect: func(connection.ConnectionConfig) error {
				if index == 1 {
					startOnce.Do(func() { close(metadataConnectStarted) })
					<-releaseMetadataConnect
				}
				return nil
			},
		}, nil
	}

	app := newDatabaseCacheConcurrencyTestApp()
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "lane-block"}

	metadataDone := make(chan error, 1)
	go func() {
		_, err := app.getMetadataDatabase(config)
		metadataDone <- err
	}()

	select {
	case <-metadataConnectStarted:
	case <-time.After(2 * time.Second):
		close(releaseMetadataConnect)
		t.Fatal("元数据通道没有开始建连，用例前提不成立")
	}

	queryDone := make(chan error, 1)
	go func() {
		_, err := app.getDatabase(config)
		queryDone <- err
	}()
	select {
	case err := <-queryDone:
		if err != nil {
			close(releaseMetadataConnect)
			t.Fatalf("查询通道建连失败：%v", err)
		}
	case <-time.After(2 * time.Second):
		close(releaseMetadataConnect)
		t.Fatal("元数据通道卡在冷建连时阻塞了查询通道")
	}

	close(releaseMetadataConnect)
	if err := <-metadataDone; err != nil {
		t.Fatalf("元数据通道建连最终失败：%v", err)
	}
}

// ⑥ 会话 App（MCP/Web 元数据请求）与根 App 共享同一份缓存。
//
// 会话 App 由 newMetadataSessionWithMode 新建，字段级缓存每次都是 nil，跨请求永远命中
// 不了——那正是「冷启动逐表 IPC 惊群」的主体。存储提升到包级后两个实例必须互通。
func TestMetadataCacheSharedBetweenSessionAndRootApp(t *testing.T) {

	owner := NewAppWithSecretStore(nil)
	session := newMetadataSessionWithMode(owner, context.Background(), false)
	if session == nil {
		t.Fatal("元数据会话创建失败")
	}
	defer session.Close()

	config := metadataTestConfig("session-shared")

	// 根 App 写入 → 会话 App 必须直接命中，不再打后端。
	rootKey := owner.buildMetadataCacheKey(config, "app", metadataCacheKindTables)
	owner.metadataCacheSet(rootKey, []string{"from-root"})
	var sessionCalls atomic.Int32
	value, err := session.app.metadataCacheFetch(rootKey, func() (interface{}, error) {
		sessionCalls.Add(1)
		return []string{"from-backend"}, nil
	})
	if err != nil {
		t.Fatalf("会话 App 读取缓存失败：%v", err)
	}
	if got := sessionCalls.Load(); got != 0 {
		t.Fatalf("会话 App 没有命中根 App 的缓存，后端调用次数=%d", got)
	}
	tables, _ := value.([]string)
	if len(tables) != 1 || tables[0] != "from-root" {
		t.Fatalf("会话 App 读到了别的值：%v", value)
	}

	// 会话 App 写入 → 根 App 必须直接命中。
	sessionKey := owner.buildMetadataCacheKey(config, "report", metadataCacheKindAllColumns)
	if _, err := session.app.metadataCacheFetch(sessionKey, func() (interface{}, error) {
		return []string{"written-by-session"}, nil
	}); err != nil {
		t.Fatalf("会话 App 写入缓存失败：%v", err)
	}
	if value, ok := owner.metadataCacheGet(sessionKey); !ok {
		t.Fatal("会话 App 写的缓存对根 App 不可见")
	} else if tables, _ := value.([]string); len(tables) != 1 || tables[0] != "written-by-session" {
		t.Fatalf("根 App 读到了别的值：%v", value)
	}

	// 合并组有意不跨会话：各会话带各自的 ctx，领头请求被取消时会把部分结果返回给
	// follower，且 follower 手里会是「别的会话的连接」。所以两条会话的并发未命中
	// 必须各打各的后端，不能收敛成一次。
	//
	// 惊群由共享缓存兜住：一旦有请求把结果写进缓存，后续请求（任意会话）直接命中。
	var firstCalls atomic.Int32
	var secondCalls atomic.Int32
	sharedKey := owner.buildMetadataCacheKey(config, "shared-cache", metadataCacheKindTables)

	first := make(chan struct{})
	second := make(chan struct{})
	var workers sync.WaitGroup
	workers.Add(2)
	go func() {
		defer workers.Done()
		<-first
		_, _ = owner.metadataCacheFetch(sharedKey, func() (interface{}, error) {
			firstCalls.Add(1)
			time.Sleep(40 * time.Millisecond)
			return []string{"from-root"}, nil
		})
	}()
	go func() {
		defer workers.Done()
		<-second
		_, _ = session.app.metadataCacheFetch(sharedKey, func() (interface{}, error) {
			secondCalls.Add(1)
			return []string{"from-session"}, nil
		})
	}()
	close(first)
	close(second)
	workers.Wait()
	if got := firstCalls.Load() + secondCalls.Load(); got < 1 {
		t.Fatal("两条会话的并发请求都没有打后端")
	}

	// 结果已共享：任意会话再取同一 key 都不再打后端。
	var afterCalls atomic.Int32
	for _, instance := range []*App{owner, session.app} {
		if _, err := instance.metadataCacheFetch(sharedKey, func() (interface{}, error) {
			afterCalls.Add(1)
			return []string{"backend"}, nil
		}); err != nil {
			t.Fatalf("共享缓存读取失败：%v", err)
		}
	}
	if got := afterCalls.Load(); got != 0 {
		t.Fatalf("共享缓存未命中，后端调用次数=%d，期望 0", got)
	}
}

// DDL 首关键词判定：只有结构变更才失效元数据缓存，普通读写不得触发。
func TestIsMetadataAffectingDDL(t *testing.T) {
	cases := []struct {
		name  string
		query string
		want  bool
	}{
		{"create table", "CREATE TABLE t (id int)", true},
		{"create or replace view", "CREATE OR REPLACE VIEW v AS SELECT 1", true},
		{"drop table", "DROP TABLE IF EXISTS t", true},
		{"drop view", "DROP VIEW v", true},
		{"drop function", "DROP FUNCTION f", true},
		{"alter table", "ALTER TABLE t ADD COLUMN c int", true},
		{"rename table", "RENAME TABLE t TO t2", true},
		{"create database", "CREATE DATABASE app", true},
		{"drop schema", "DROP SCHEMA s", true},
		{"leading comment then create", "-- 注释\nCREATE TABLE t (id int)", true},
		{"lowercase create", "  create index i on t(id)", true},
		{"select", "SELECT * FROM t", false},
		{"leading comment then select", "/* c */\nSELECT 1", false},
		{"with cte", "WITH x AS (SELECT 1) SELECT * FROM x", false},
		{"insert", "INSERT INTO t VALUES (1)", false},
		{"update", "UPDATE t SET a = 1", false},
		{"delete", "DELETE FROM t", false},
		{"truncate only clears data", "TRUNCATE TABLE t", false},
		{"show tables", "SHOW TABLES", false},
		{"empty", "", false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := isMetadataAffectingDDL(testCase.query); got != testCase.want {
				t.Fatalf("isMetadataAffectingDDL(%q) = %v, want %v", testCase.query, got, testCase.want)
			}
		})
	}
}

// DDL 钩子：成功才失效，失败必须保留缓存（失败的 DDL 没有改变真实结构）。
func TestInvalidateMetadataAfterDDLOnlyClearsOnSuccess(t *testing.T) {
	app := newMetadataCacheTestApp()
	config := metadataTestConfig("ddl-hook")

	seed := func(dbName string) string {
		key := app.buildMetadataCacheKey(normalizeMetadataRunConfig(config, dbName), dbName, metadataCacheKindTables)
		app.metadataCacheSet(key, []string{"t"})
		return key
	}

	failedKey := seed("app")
	app.invalidateMetadataAfterDDL(connection.QueryResult{Success: false, Message: "boom"}, config, "app")
	if _, ok := app.metadataCacheGet(failedKey); !ok {
		t.Fatal("失败的 DDL 不该清空元数据缓存")
	}

	successKey := seed("app")
	app.invalidateMetadataAfterDDL(connection.QueryResult{Success: true}, config, "app")
	if _, ok := app.metadataCacheGet(successKey); ok {
		t.Fatal("成功的 DDL 没有失效元数据缓存")
	}

	// 只清目标库：他库缓存必须保留。
	otherKey := seed("report")
	app.invalidateMetadataAfterDDL(connection.QueryResult{Success: true}, config, "app")
	if _, ok := app.metadataCacheGet(otherKey); !ok {
		t.Fatal("DDL 失效误删了其它库的元数据缓存")
	}
}

// 走 SQL 编辑器的 DDL（dbQueryWithCancel）必须真的触到钩子，普通查询不得触发。
func TestDBQueryWithCancelInvalidatesMetadataCacheOnDDL(t *testing.T) {
	installFakeOptionalDriverRuntime(t)

	originalNewDatabaseFunc := newDatabaseFunc
	t.Cleanup(func() { newDatabaseFunc = originalNewDatabaseFunc })

	newDatabaseFunc = func(string) (db.Database, error) {
		return &fakeStartupRetryDB{}, nil
	}

	app := NewAppWithSecretStore(nil)
	app.startedAt = time.Now().Add(-startupConnectRetryWindow - time.Second)
	config := connection.ConnectionConfig{Type: "sqlserver", Host: "127.0.0.1", Port: 1433, User: "sa"}

	seed := func(dbName string) string {
		key := app.buildMetadataCacheKey(normalizeMetadataRunConfig(config, dbName), dbName, metadataCacheKindTables)
		app.metadataCacheSet(key, []string{"t"})
		return key
	}

	// 普通查询：缓存必须原样保留。
	selectKey := seed("app")
	if result := app.DBQueryWithCancel(config, "app", "SELECT 1", ""); !result.Success {
		t.Fatalf("SELECT 执行失败：%s", result.Message)
	}
	if _, ok := app.metadataCacheGet(selectKey); !ok {
		t.Fatal("普通 SELECT 不该清空元数据缓存")
	}

	// DDL：成功后必须清空该库缓存。
	ddlKey := seed("app")
	if result := app.DBQueryWithCancel(config, "app", "DROP TABLE t", ""); !result.Success {
		t.Fatalf("DDL 执行失败：%s", result.Message)
	}
	if _, ok := app.metadataCacheGet(ddlKey); ok {
		t.Fatal("SQL 编辑器执行的 DDL 没有失效元数据缓存")
	}
}

// ddlProbeDB 是为 DDL 钩子用例准备的最小驱动桩：记录执行过的语句，并可按需让 Exec 失败。
type ddlProbeDB struct {
	execErr  error
	executed []string
}

func (f *ddlProbeDB) Connect(connection.ConnectionConfig) error { return nil }
func (f *ddlProbeDB) Close() error                              { return nil }
func (f *ddlProbeDB) Ping() error                               { return nil }
func (f *ddlProbeDB) Query(string) ([]map[string]interface{}, []string, error) {
	return nil, nil, nil
}
func (f *ddlProbeDB) Exec(query string) (int64, error) {
	f.executed = append(f.executed, query)
	if f.execErr != nil {
		return 0, f.execErr
	}
	return 0, nil
}
func (f *ddlProbeDB) GetDatabases() ([]string, error) { return nil, nil }
func (f *ddlProbeDB) GetTables(string) ([]string, error) {
	return nil, nil
}
func (f *ddlProbeDB) GetCreateStatement(string, string) (string, error) { return "", nil }
func (f *ddlProbeDB) GetColumns(string, string) ([]connection.ColumnDefinition, error) {
	return nil, nil
}
func (f *ddlProbeDB) GetAllColumns(string) ([]connection.ColumnDefinitionWithTable, error) {
	return nil, nil
}
func (f *ddlProbeDB) GetIndexes(string, string) ([]connection.IndexDefinition, error) {
	return nil, nil
}
func (f *ddlProbeDB) GetForeignKeys(string, string) ([]connection.ForeignKeyDefinition, error) {
	return nil, nil
}
func (f *ddlProbeDB) GetTriggers(string, string) ([]connection.TriggerDefinition, error) {
	return nil, nil
}

var _ db.Database = (*ddlProbeDB)(nil)

// installDDLProbeApp 返回一个直接走 DDL 方法（不经过 SQL 编辑器）的应用与探针驱动。
func installDDLProbeApp(t *testing.T, probe *ddlProbeDB) *App {
	t.Helper()
	installFakeOptionalDriverRuntime(t)
	originalNewDatabaseFunc := newDatabaseFunc
	t.Cleanup(func() { newDatabaseFunc = originalNewDatabaseFunc })
	newDatabaseFunc = func(string) (db.Database, error) { return probe, nil }

	app := NewAppWithSecretStore(nil)
	app.startedAt = time.Now().Add(-startupConnectRetryWindow - time.Second)
	return app
}

// DDL 方法级钩子：DropTable 成功后必须清空该库元数据缓存。
func TestDropTableInvalidatesMetadataCache(t *testing.T) {
	probe := &ddlProbeDB{}
	app := installDDLProbeApp(t, probe)
	config := connection.ConnectionConfig{Type: "mysql", Host: "127.0.0.1", Port: 3306, User: "root"}

	key := app.buildMetadataCacheKey(normalizeMetadataRunConfig(config, "app"), "app", metadataCacheKindTables)
	app.metadataCacheSet(key, []string{"orders"})

	result := app.DropTable(config, "app", "orders")
	if !result.Success {
		t.Fatalf("DropTable 失败：%s", result.Message)
	}
	if len(probe.executed) == 0 {
		t.Fatal("DropTable 没有下发任何语句")
	}
	if _, ok := app.metadataCacheGet(key); ok {
		t.Fatal("DropTable 成功后没有失效元数据缓存，侧栏树会继续显示已删除的表")
	}
}

// DDL 失败时不得清缓存：失败的 DDL 没有改变真实结构。
func TestDropTableFailureKeepsMetadataCache(t *testing.T) {
	probe := &ddlProbeDB{execErr: errors.New("table is locked")}
	app := installDDLProbeApp(t, probe)
	config := connection.ConnectionConfig{Type: "mysql", Host: "127.0.0.1", Port: 3306, User: "root"}

	key := app.buildMetadataCacheKey(normalizeMetadataRunConfig(config, "app"), "app", metadataCacheKindTables)
	app.metadataCacheSet(key, []string{"orders"})

	result := app.DropTable(config, "app", "orders")
	if result.Success {
		t.Fatal("DropTable 在上层驱动报错时仍然返回成功")
	}
	if _, ok := app.metadataCacheGet(key); !ok {
		t.Fatal("失败的 DDL 清空了元数据缓存，会让侧栏白刷一次")
	}
}

// 另一条 DDL 通道（库级）也必须接线：CreateDatabase 成功后同样失效缓存。
func TestCreateDatabaseInvalidatesMetadataCache(t *testing.T) {
	probe := &ddlProbeDB{}
	app := installDDLProbeApp(t, probe)
	config := connection.ConnectionConfig{Type: "mysql", Host: "127.0.0.1", Port: 3306, User: "root"}

	key := app.buildMetadataCacheKey(normalizeMetadataRunConfig(config, "app"), "app", metadataCacheKindTables)
	app.metadataCacheSet(key, []string{"orders"})

	result := app.CreateDatabase(config, "app", "", "")
	if !result.Success {
		t.Fatalf("CreateDatabase 失败：%s", result.Message)
	}
	if _, ok := app.metadataCacheGet(key); ok {
		t.Fatal("CreateDatabase 成功后没有失效元数据缓存")
	}
}
