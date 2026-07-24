package app

import (
	"errors"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

type cacheConcurrencyDB struct {
	connect func(connection.ConnectionConfig) error
	close   func() error
}

func (f *cacheConcurrencyDB) Connect(config connection.ConnectionConfig) error {
	if f.connect != nil {
		return f.connect(config)
	}
	return nil
}

func (f *cacheConcurrencyDB) Close() error {
	if f.close != nil {
		return f.close()
	}
	return nil
}

func (f *cacheConcurrencyDB) Ping() error { return nil }
func (f *cacheConcurrencyDB) Query(string) ([]map[string]interface{}, []string, error) {
	return nil, nil, nil
}
func (f *cacheConcurrencyDB) Exec(string) (int64, error) { return 0, nil }
func (f *cacheConcurrencyDB) GetDatabases() ([]string, error) {
	return nil, nil
}
func (f *cacheConcurrencyDB) GetTables(string) ([]string, error) { return nil, nil }
func (f *cacheConcurrencyDB) GetCreateStatement(string, string) (string, error) {
	return "", nil
}
func (f *cacheConcurrencyDB) GetColumns(string, string) ([]connection.ColumnDefinition, error) {
	return nil, nil
}
func (f *cacheConcurrencyDB) GetAllColumns(string) ([]connection.ColumnDefinitionWithTable, error) {
	return nil, nil
}
func (f *cacheConcurrencyDB) GetIndexes(string, string) ([]connection.IndexDefinition, error) {
	return nil, nil
}
func (f *cacheConcurrencyDB) GetForeignKeys(string, string) ([]connection.ForeignKeyDefinition, error) {
	return nil, nil
}
func (f *cacheConcurrencyDB) GetTriggers(string, string) ([]connection.TriggerDefinition, error) {
	return nil, nil
}

var _ db.Database = (*cacheConcurrencyDB)(nil)

func installDatabaseCacheConcurrencyTestHooks(t *testing.T) {
	t.Helper()
	originalNewDatabaseFunc := newDatabaseFunc
	originalResolveDialConfigWithProxyFunc := resolveDialConfigWithProxyFunc
	originalDriverRuntimeSupportStatusFunc := driverRuntimeSupportStatusFunc
	originalVerifyDriverAgentRevisionFunc := verifyDriverAgentRevisionFunc
	t.Cleanup(func() {
		newDatabaseFunc = originalNewDatabaseFunc
		resolveDialConfigWithProxyFunc = originalResolveDialConfigWithProxyFunc
		driverRuntimeSupportStatusFunc = originalDriverRuntimeSupportStatusFunc
		verifyDriverAgentRevisionFunc = originalVerifyDriverAgentRevisionFunc
	})
	resolveDialConfigWithProxyFunc = func(config connection.ConnectionConfig) (connection.ConnectionConfig, error) {
		return config, nil
	}
	driverRuntimeSupportStatusFunc = func(string) (bool, string) { return true, "" }
	verifyDriverAgentRevisionFunc = func(connection.ConnectionConfig) error { return nil }
}

func newDatabaseCacheConcurrencyTestApp() *App {
	return &App{
		startedAt:       time.Now().Add(-startupConnectRetryWindow - time.Second),
		dbCache:         make(map[string]cachedDatabase),
		connectFailures: make(map[string]cachedConnectFailure),
		runningQueries:  make(map[string]queryContext),
	}
}

func TestGetDatabaseWithPing_CoalescesConcurrentColdConnectsPerCacheKey(t *testing.T) {
	installDatabaseCacheConcurrencyTestHooks(t)

	const callers = 32
	var factoryCalls atomic.Int32
	var connectCalls atomic.Int32
	connectStarted := make(chan struct{})
	releaseConnect := make(chan struct{})
	var connectStartedOnce sync.Once
	newDatabaseFunc = func(string) (db.Database, error) {
		factoryCalls.Add(1)
		return &cacheConcurrencyDB{
			connect: func(connection.ConnectionConfig) error {
				connectCalls.Add(1)
				connectStartedOnce.Do(func() { close(connectStarted) })
				<-releaseConnect
				return nil
			},
		}, nil
	}

	app := newDatabaseCacheConcurrencyTestApp()
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "same-key"}
	start := make(chan struct{})
	results := make(chan db.Database, callers)
	errors := make(chan error, callers)
	var workers sync.WaitGroup
	workers.Add(callers)
	for range callers {
		go func() {
			defer workers.Done()
			<-start
			instance, err := app.getDatabaseWithPing(config, false)
			results <- instance
			errors <- err
		}()
	}
	close(start)
	select {
	case <-connectStarted:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for the first database connection")
	}
	// Give all callers enough time to reach the same cold-cache path while the
	// first physical connection is deliberately held open.
	time.Sleep(100 * time.Millisecond)
	close(releaseConnect)
	workers.Wait()
	close(results)
	close(errors)

	for err := range errors {
		if err != nil {
			t.Fatalf("getDatabaseWithPing returned error: %v", err)
		}
	}
	var shared db.Database
	for instance := range results {
		if instance == nil {
			t.Fatal("getDatabaseWithPing returned a nil database")
		}
		if shared == nil {
			shared = instance
			continue
		}
		if instance != shared {
			t.Fatal("concurrent callers did not receive the same cached database")
		}
	}
	if got := factoryCalls.Load(); got != 1 {
		t.Fatalf("expected one driver factory call for one cache key, got %d", got)
	}
	if got := connectCalls.Load(); got != 1 {
		t.Fatalf("expected one physical connection for one cache key, got %d", got)
	}
}

func TestGetDatabaseWithPing_DifferentCacheKeysConnectConcurrently(t *testing.T) {
	installDatabaseCacheConcurrencyTestHooks(t)

	connectStarted := make(chan string, 2)
	releaseConnect := make(chan struct{})
	newDatabaseFunc = func(string) (db.Database, error) {
		return &cacheConcurrencyDB{
			connect: func(config connection.ConnectionConfig) error {
				connectStarted <- config.Database
				<-releaseConnect
				return nil
			},
		}, nil
	}

	app := newDatabaseCacheConcurrencyTestApp()
	configs := []connection.ConnectionConfig{
		{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "first-key"},
		{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "second-key"},
	}
	results := make(chan error, len(configs))
	for _, config := range configs {
		config := config
		go func() {
			_, err := app.getDatabaseWithPing(config, false)
			results <- err
		}()
	}

	started := make(map[string]bool, len(configs))
	deadline := time.NewTimer(time.Second)
	defer deadline.Stop()
	for len(started) < len(configs) {
		select {
		case databaseName := <-connectStarted:
			started[databaseName] = true
		case <-deadline.C:
			close(releaseConnect)
			for range configs {
				<-results
			}
			t.Fatal("different cache keys were serialized behind one connection flight")
		}
	}
	close(releaseConnect)
	for range configs {
		if err := <-results; err != nil {
			t.Fatalf("getDatabaseWithPing returned error: %v", err)
		}
	}
}

func TestGetDatabaseWithPing_SingleflightFollowerAppliesItsKeepAlivePolicy(t *testing.T) {
	installDatabaseCacheConcurrencyTestHooks(t)

	previousMaxProcs := runtime.GOMAXPROCS(1)
	t.Cleanup(func() { runtime.GOMAXPROCS(previousMaxProcs) })

	connectStarted := make(chan struct{})
	releaseConnect := make(chan struct{})
	var connectStartedOnce sync.Once
	created := &cacheConcurrencyDB{
		connect: func(connection.ConnectionConfig) error {
			connectStartedOnce.Do(func() { close(connectStarted) })
			<-releaseConnect
			return nil
		},
	}
	newDatabaseFunc = func(string) (db.Database, error) { return created, nil }

	app := newDatabaseCacheConcurrencyTestApp()
	leaderConfig := connection.ConnectionConfig{
		Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "shared-policy",
	}
	followerConfig := leaderConfig
	followerConfig.KeepAliveEnabled = true
	followerConfig.KeepAliveIntervalMinutes = 7
	followerConfig.KeepAliveSQL = " SELECT 42 "
	if getCacheKey(leaderConfig) != getCacheKey(followerConfig) {
		t.Fatal("keepalive policy fields must not change the physical connection cache key")
	}

	results := make(chan error, 2)
	go func() {
		_, err := app.getDatabaseWithPing(leaderConfig, false)
		results <- err
	}()
	select {
	case <-connectStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the leader connection")
	}

	go func() {
		_, err := app.getDatabaseWithPing(followerConfig, false)
		results <- err
	}()
	// With one P, the follower runs until it joins the leader's blocked flight,
	// giving this regression test an event-driven ordering without a sleep.
	runtime.Gosched()
	close(releaseConnect)
	for range 2 {
		if err := <-results; err != nil {
			t.Fatalf("getDatabaseWithPing returned error: %v", err)
		}
	}

	key := getCacheKey(followerConfig)
	app.mu.RLock()
	entry := app.dbCache[key]
	app.mu.RUnlock()
	if !entry.keepAliveEnabled || entry.keepAliveInterval != 7*time.Minute {
		t.Fatalf("expected follower keepalive policy, enabled=%t interval=%s", entry.keepAliveEnabled, entry.keepAliveInterval)
	}
	if entry.keepAliveSQL != "SELECT 42" || entry.keepAliveDBType != "postgres" {
		t.Fatalf("expected follower custom keepalive SQL, sql=%q dbType=%q", entry.keepAliveSQL, entry.keepAliveDBType)
	}
}

func TestInvalidateCachedDatabase_SlowCloseDoesNotBlockUnrelatedColdConnect(t *testing.T) {
	installDatabaseCacheConcurrencyTestHooks(t)

	closeStarted := make(chan struct{})
	releaseClose := make(chan struct{})
	var closeStartedOnce sync.Once
	slowDB := &cacheConcurrencyDB{
		close: func() error {
			closeStartedOnce.Do(func() { close(closeStarted) })
			<-releaseClose
			return nil
		},
	}
	fastConnectStarted := make(chan struct{})
	var fastConnectStartedOnce sync.Once
	fastDB := &cacheConcurrencyDB{
		connect: func(connection.ConnectionConfig) error {
			fastConnectStartedOnce.Do(func() { close(fastConnectStarted) })
			return nil
		},
	}
	newDatabaseFunc = func(string) (db.Database, error) { return fastDB, nil }

	app := newDatabaseCacheConcurrencyTestApp()
	slowConfig := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "slow-close"}
	app.dbCache[getCacheKey(slowConfig)] = cachedDatabase{
		inst:     slowDB,
		lastPing: time.Now(),
		config:   normalizeCacheKeyConfig(slowConfig),
	}
	invalidateDone := make(chan bool, 1)
	go func() {
		invalidateDone <- app.invalidateCachedDatabase(slowConfig, nil)
	}()
	select {
	case <-closeStarted:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for the slow database close")
	}

	fastConfig := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "unrelated"}
	connectDone := make(chan error, 1)
	go func() {
		instance, err := app.getDatabaseWithPing(fastConfig, false)
		if err == nil && instance != fastDB {
			err = errors.New("unexpected database instance for unrelated cache key")
		}
		connectDone <- err
	}()

	select {
	case <-fastConnectStarted:
	case <-time.After(2 * time.Second):
		close(releaseClose)
		<-invalidateDone
		t.Fatal("slow Close held the global database cache lock and blocked an unrelated connection")
	}
	close(releaseClose)
	select {
	case err := <-connectDone:
		if err != nil {
			t.Fatalf("unrelated cold connection failed: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the unrelated cold connection")
	}
	if invalidated := <-invalidateDone; !invalidated {
		t.Fatal("expected the slow cached database to be invalidated")
	}
}

func TestDBReleaseConnection_InvalidatesInflightLeaderAndFollower(t *testing.T) {
	installDatabaseCacheConcurrencyTestHooks(t)

	previousMaxProcs := runtime.GOMAXPROCS(1)
	t.Cleanup(func() { runtime.GOMAXPROCS(previousMaxProcs) })

	connectStarted := make(chan struct{})
	releaseConnect := make(chan struct{})
	var connectStartedOnce sync.Once
	var closeCalls atomic.Int32
	created := &cacheConcurrencyDB{
		connect: func(connection.ConnectionConfig) error {
			connectStartedOnce.Do(func() { close(connectStarted) })
			<-releaseConnect
			return nil
		},
		close: func() error {
			closeCalls.Add(1)
			return nil
		},
	}
	newDatabaseFunc = func(string) (db.Database, error) { return created, nil }

	app := newDatabaseCacheConcurrencyTestApp()
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "release-race"}
	type connectResult struct {
		instance db.Database
		err      error
	}
	results := make(chan connectResult, 2)
	go func() {
		instance, err := app.getDatabaseWithPing(config, false)
		results <- connectResult{instance: instance, err: err}
	}()
	select {
	case <-connectStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the leader connection")
	}

	followerStarted := make(chan struct{})
	go func() {
		close(followerStarted)
		instance, err := app.getDatabaseWithPing(config, false)
		results <- connectResult{instance: instance, err: err}
	}()
	<-followerStarted
	// Give the follower a scheduling turn to join the blocked singleflight.
	// This mirrors the existing high-contention coalescing regression above.
	time.Sleep(25 * time.Millisecond)

	releaseResult := app.DBReleaseConnection(config)
	if !releaseResult.Success {
		close(releaseConnect)
		for range 2 {
			<-results
		}
		t.Fatalf("DBReleaseConnection failed: %s", releaseResult.Message)
	}
	close(releaseConnect)

	for range 2 {
		result := <-results
		if !errors.Is(result.err, errDatabaseConnectionReleased) {
			t.Fatalf("expected release error from the invalidated flight, got %v", result.err)
		}
		if result.instance != nil {
			t.Fatal("an invalidated connection was returned to a caller")
		}
	}
	if got := closeCalls.Load(); got != 1 {
		t.Fatalf("expected the late physical connection to be closed once, got %d", got)
	}
	app.mu.RLock()
	cacheSize := len(app.dbCache)
	flightCount := len(app.dbConnectFlights)
	app.mu.RUnlock()
	if cacheSize != 0 {
		t.Fatalf("released in-flight connection was resurrected in cache: %d entries", cacheSize)
	}
	if flightCount != 0 {
		t.Fatalf("completed release left %d active flight tokens", flightCount)
	}
}

func TestDBReleaseConnection_ReleaseWinsOverLateConnectFailureWithoutCooldown(t *testing.T) {
	installDatabaseCacheConcurrencyTestHooks(t)

	connectStarted := make(chan struct{})
	releaseConnect := make(chan struct{})
	var closeCalls atomic.Int32
	newDatabaseFunc = func(string) (db.Database, error) {
		return &cacheConcurrencyDB{
			connect: func(connection.ConnectionConfig) error {
				close(connectStarted)
				<-releaseConnect
				return errors.New("late dial failure")
			},
			close: func() error {
				closeCalls.Add(1)
				return nil
			},
		}, nil
	}

	app := newDatabaseCacheConcurrencyTestApp()
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "release-failure-race"}
	connectDone := make(chan error, 1)
	go func() {
		_, err := app.getDatabaseWithPing(config, false)
		connectDone <- err
	}()
	select {
	case <-connectStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the failing connection")
	}
	if result := app.DBReleaseConnection(config); !result.Success {
		close(releaseConnect)
		<-connectDone
		t.Fatalf("DBReleaseConnection failed: %s", result.Message)
	}
	close(releaseConnect)
	if err := <-connectDone; !errors.Is(err, errDatabaseConnectionReleased) {
		t.Fatalf("expected release to win over the late dial error, got %v", err)
	}
	if got := closeCalls.Load(); got != 1 {
		t.Fatalf("expected failed physical connection to close once, got %d", got)
	}
	app.mu.RLock()
	failureCount := len(app.connectFailures)
	app.mu.RUnlock()
	if failureCount != 0 {
		t.Fatalf("released flight poisoned connect cooldown with %d entries", failureCount)
	}
}

func TestDBReleaseConnection_AllowsFreshFileDatabaseFlightBeforeOldConnectFinishes(t *testing.T) {
	installDatabaseCacheConcurrencyTestHooks(t)

	firstConnectStarted := make(chan struct{})
	releaseFirstConnect := make(chan struct{})
	secondConnectStarted := make(chan struct{})
	var factoryCalls atomic.Int32
	var firstCloseCalls atomic.Int32
	firstDB := &cacheConcurrencyDB{
		connect: func(connection.ConnectionConfig) error {
			close(firstConnectStarted)
			<-releaseFirstConnect
			return nil
		},
		close: func() error {
			firstCloseCalls.Add(1)
			return nil
		},
	}
	secondDB := &cacheConcurrencyDB{
		connect: func(connection.ConnectionConfig) error {
			close(secondConnectStarted)
			return nil
		},
	}
	newDatabaseFunc = func(string) (db.Database, error) {
		if factoryCalls.Add(1) == 1 {
			return firstDB, nil
		}
		return secondDB, nil
	}

	app := newDatabaseCacheConcurrencyTestApp()
	config := connection.ConnectionConfig{Type: "sqlite", Host: t.TempDir() + "/release-race.sqlite"}
	firstDone := make(chan error, 1)
	go func() {
		_, err := app.getDatabaseWithPing(config, false)
		firstDone <- err
	}()
	select {
	case <-firstConnectStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the old file database flight")
	}

	if result := app.DBReleaseConnection(config); !result.Success {
		close(releaseFirstConnect)
		<-firstDone
		t.Fatalf("DBReleaseConnection failed: %s", result.Message)
	}
	secondDone := make(chan struct {
		instance db.Database
		err      error
	}, 1)
	go func() {
		instance, err := app.getDatabaseWithPing(config, false)
		secondDone <- struct {
			instance db.Database
			err      error
		}{instance: instance, err: err}
	}()
	select {
	case <-secondConnectStarted:
	case <-time.After(2 * time.Second):
		close(releaseFirstConnect)
		<-firstDone
		<-secondDone
		t.Fatal("fresh connect joined the released singleflight instead of starting immediately")
	}
	secondResult := <-secondDone
	if secondResult.err != nil || secondResult.instance != secondDB {
		close(releaseFirstConnect)
		<-firstDone
		t.Fatalf("fresh connect failed: instance=%p err=%v", secondResult.instance, secondResult.err)
	}

	close(releaseFirstConnect)
	if err := <-firstDone; !errors.Is(err, errDatabaseConnectionReleased) {
		t.Fatalf("expected old flight to stay invalidated, got %v", err)
	}
	if got := firstCloseCalls.Load(); got != 1 {
		t.Fatalf("expected old file database instance to close once, got %d", got)
	}
	key := getCacheKey(config)
	app.mu.RLock()
	entry := app.dbCache[key]
	cacheSize := len(app.dbCache)
	app.mu.RUnlock()
	if cacheSize != 1 || entry.inst != secondDB {
		t.Fatalf("old flight displaced the fresh cache entry: size=%d instance=%p", cacheSize, entry.inst)
	}
}

func TestDBReleaseConnection_InvalidatesAllInflightDatabaseKeysForSameInstance(t *testing.T) {
	installDatabaseCacheConcurrencyTestHooks(t)

	connectStarted := make(chan string, 2)
	releaseConnect := make(chan struct{})
	var closeCalls atomic.Int32
	newDatabaseFunc = func(string) (db.Database, error) {
		return &cacheConcurrencyDB{
			connect: func(config connection.ConnectionConfig) error {
				connectStarted <- config.Database
				<-releaseConnect
				return nil
			},
			close: func() error {
				closeCalls.Add(1)
				return nil
			},
		}, nil
	}

	app := newDatabaseCacheConcurrencyTestApp()
	configs := []connection.ConnectionConfig{
		{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "main"},
		{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "analytics", ConnectionParams: "application_name=gonavi"},
	}
	errorsByDatabase := make(chan error, len(configs))
	for _, config := range configs {
		config := config
		go func() {
			_, err := app.getDatabaseWithPing(config, false)
			errorsByDatabase <- err
		}()
	}
	started := make(map[string]bool, len(configs))
	for len(started) < len(configs) {
		select {
		case databaseName := <-connectStarted:
			started[databaseName] = true
		case <-time.After(2 * time.Second):
			close(releaseConnect)
			for range configs {
				<-errorsByDatabase
			}
			t.Fatal("timed out waiting for both same-instance flights")
		}
	}
	if result := app.DBReleaseConnection(configs[0]); !result.Success {
		close(releaseConnect)
		for range configs {
			<-errorsByDatabase
		}
		t.Fatalf("DBReleaseConnection failed: %s", result.Message)
	}
	close(releaseConnect)
	for range configs {
		if err := <-errorsByDatabase; !errors.Is(err, errDatabaseConnectionReleased) {
			t.Fatalf("expected every same-instance flight to be invalidated, got %v", err)
		}
	}
	if got := closeCalls.Load(); got != int32(len(configs)) {
		t.Fatalf("expected every late connection to close, got %d", got)
	}
	app.mu.RLock()
	cacheSize := len(app.dbCache)
	app.mu.RUnlock()
	if cacheSize != 0 {
		t.Fatalf("same-instance release left %d cache entries", cacheSize)
	}
}

func TestBeginDatabaseShutdown_InvalidatesInflightConnectAndRejectsNewConnects(t *testing.T) {
	installDatabaseCacheConcurrencyTestHooks(t)

	connectStarted := make(chan struct{})
	releaseConnect := make(chan struct{})
	var factoryCalls atomic.Int32
	var closeCalls atomic.Int32
	newDatabaseFunc = func(string) (db.Database, error) {
		factoryCalls.Add(1)
		return &cacheConcurrencyDB{
			connect: func(connection.ConnectionConfig) error {
				close(connectStarted)
				<-releaseConnect
				return nil
			},
			close: func() error {
				closeCalls.Add(1)
				return nil
			},
		}, nil
	}

	app := newDatabaseCacheConcurrencyTestApp()
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "shutdown-race"}
	connectDone := make(chan error, 1)
	go func() {
		_, err := app.getDatabaseWithPing(config, false)
		connectDone <- err
	}()
	select {
	case <-connectStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the in-flight connection")
	}

	app.beginDatabaseShutdown()
	close(releaseConnect)
	if err := <-connectDone; !errors.Is(err, errDatabaseConnectionShutdown) {
		t.Fatalf("expected shutdown error from the late flight, got %v", err)
	}
	if got := closeCalls.Load(); got != 1 {
		t.Fatalf("expected late shutdown connection to close once, got %d", got)
	}
	if _, err := app.getDatabase(config); !errors.Is(err, errDatabaseConnectionShutdown) {
		t.Fatalf("expected new connect after shutdown to be rejected, got %v", err)
	}
	if got := factoryCalls.Load(); got != 1 {
		t.Fatalf("shutdown created an additional physical connection: %d", got)
	}
	app.mu.RLock()
	cacheSize := len(app.dbCache)
	app.mu.RUnlock()
	if cacheSize != 0 {
		t.Fatalf("shutdown race resurrected %d cache entries", cacheSize)
	}
}

func TestCloseCachedDatabasesForShutdown_SlowCloseDoesNotHoldCacheLock(t *testing.T) {
	closeStarted := make(chan struct{})
	releaseClose := make(chan struct{})
	app := newDatabaseCacheConcurrencyTestApp()
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "shutdown-close"}
	app.dbCache[getCacheKey(config)] = cachedDatabase{
		inst: &cacheConcurrencyDB{close: func() error {
			close(closeStarted)
			<-releaseClose
			return nil
		}},
		config: normalizeCacheKeyConfig(config),
	}

	closeDone := make(chan struct{})
	go func() {
		app.closeCachedDatabasesForShutdown()
		close(closeDone)
	}()
	select {
	case <-closeStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the slow shutdown close")
	}

	lockAcquired := make(chan struct{})
	go func() {
		app.mu.Lock()
		app.mu.Unlock()
		close(lockAcquired)
	}()
	select {
	case <-lockAcquired:
	case <-time.After(time.Second):
		close(releaseClose)
		<-closeDone
		t.Fatal("slow shutdown Close held the global database cache lock")
	}
	close(releaseClose)
	select {
	case <-closeDone:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for shutdown close to finish")
	}
}

func TestRecordConnectFailureForFlight_CancellationAndCooldownCommitAreLinearized(t *testing.T) {
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "failure-linearization"}
	key := getCacheKey(config)
	dialErr := errors.New("dial failed")

	t.Run("release before record", func(t *testing.T) {
		app := newDatabaseCacheConcurrencyTestApp()
		flight, err := app.beginDatabaseConnectFlight(key, config)
		if err != nil {
			t.Fatalf("begin flight: %v", err)
		}
		defer app.finishDatabaseConnectFlight(flight)

		// Reproduce the old check-then-record window: validation succeeds, then a
		// release wins before the cooldown write is attempted.
		if err := app.databaseConnectFlightError(flight); err != nil {
			t.Fatalf("flight unexpectedly invalid before release: %v", err)
		}
		app.releaseCachedDatabaseConnectionsForConfig(config)
		if err := app.recordConnectFailureForFlight(flight, key, dialErr); !errors.Is(err, errDatabaseConnectionReleased) {
			t.Fatalf("expected released flight to reject cooldown write, got %v", err)
		}
		app.mu.RLock()
		failureCount := len(app.connectFailures)
		app.mu.RUnlock()
		if failureCount != 0 {
			t.Fatalf("released flight wrote %d stale cooldown entries", failureCount)
		}
	})

	t.Run("release after record", func(t *testing.T) {
		app := newDatabaseCacheConcurrencyTestApp()
		flight, err := app.beginDatabaseConnectFlight(key, config)
		if err != nil {
			t.Fatalf("begin flight: %v", err)
		}
		defer app.finishDatabaseConnectFlight(flight)

		if err := app.recordConnectFailureForFlight(flight, key, dialErr); err != nil {
			t.Fatalf("record active flight failure: %v", err)
		}
		app.releaseCachedDatabaseConnectionsForConfig(config)
		app.mu.RLock()
		_, exists := app.connectFailures[key]
		app.mu.RUnlock()
		if exists {
			t.Fatal("release did not clear cooldown committed by its active flight")
		}
	})

	t.Run("shutdown before record", func(t *testing.T) {
		app := newDatabaseCacheConcurrencyTestApp()
		flight, err := app.beginDatabaseConnectFlight(key, config)
		if err != nil {
			t.Fatalf("begin flight: %v", err)
		}
		defer app.finishDatabaseConnectFlight(flight)

		if err := app.databaseConnectFlightError(flight); err != nil {
			t.Fatalf("flight unexpectedly invalid before shutdown: %v", err)
		}
		app.beginDatabaseShutdown()
		if err := app.recordConnectFailureForFlight(flight, key, dialErr); !errors.Is(err, errDatabaseConnectionShutdown) {
			t.Fatalf("expected shutdown to reject cooldown write, got %v", err)
		}
		app.mu.RLock()
		failureCount := len(app.connectFailures)
		app.mu.RUnlock()
		if failureCount != 0 {
			t.Fatalf("shutdown flight wrote %d stale cooldown entries", failureCount)
		}
	})
}

func TestClearConnectFailuresForFlightLocked_StaleFlightCannotEraseFreshCooldown(t *testing.T) {
	app := newDatabaseCacheConcurrencyTestApp()
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, User: "postgres", Database: "clear-linearization"}
	key := getCacheKey(config)

	staleFlight, err := app.beginDatabaseConnectFlight(key, config)
	if err != nil {
		t.Fatalf("begin stale flight: %v", err)
	}
	defer app.finishDatabaseConnectFlight(staleFlight)
	if err := app.databaseConnectFlightError(staleFlight); err != nil {
		t.Fatalf("stale flight unexpectedly invalid before release: %v", err)
	}
	app.releaseCachedDatabaseConnectionsForConfig(config)

	freshFlight, err := app.beginDatabaseConnectFlight(key, config)
	if err != nil {
		t.Fatalf("begin fresh flight: %v", err)
	}
	defer app.finishDatabaseConnectFlight(freshFlight)
	freshErr := errors.New("fresh dial failure")
	if err := app.recordConnectFailureForFlight(freshFlight, key, freshErr); err != nil {
		t.Fatalf("record fresh cooldown: %v", err)
	}

	// Reproduce the old validation-then-clear window. The stale flight must be
	// revalidated in the same critical section as the deletion.
	app.mu.Lock()
	clearErr := app.clearConnectFailuresForFlightLocked(staleFlight, key)
	failure, exists := app.connectFailures[key]
	app.mu.Unlock()
	if !errors.Is(clearErr, errDatabaseConnectionReleased) {
		t.Fatalf("expected stale clear to be rejected, got %v", clearErr)
	}
	if !exists || !errors.Is(failure.err, freshErr) {
		t.Fatalf("stale flight erased or replaced fresh cooldown: exists=%t err=%v", exists, failure.err)
	}
}

func TestDBReleaseConnection_ForgetIsLinearizedBeforeFreshSingleflight(t *testing.T) {
	installDatabaseCacheConcurrencyTestHooks(t)

	firstConnectStarted := make(chan struct{})
	releaseFirstConnect := make(chan struct{})
	secondConnectStarted := make(chan struct{})
	releaseSecondConnect := make(chan struct{})
	duplicateConnectStarted := make(chan struct{})
	var duplicateConnectOnce sync.Once
	var factoryCalls atomic.Int32
	firstDB := &cacheConcurrencyDB{connect: func(connection.ConnectionConfig) error {
		close(firstConnectStarted)
		<-releaseFirstConnect
		return nil
	}}
	secondDB := &cacheConcurrencyDB{connect: func(connection.ConnectionConfig) error {
		close(secondConnectStarted)
		<-releaseSecondConnect
		return nil
	}}
	newDatabaseFunc = func(string) (db.Database, error) {
		switch factoryCalls.Add(1) {
		case 1:
			return firstDB, nil
		case 2:
			return secondDB, nil
		default:
			return &cacheConcurrencyDB{connect: func(connection.ConnectionConfig) error {
				duplicateConnectOnce.Do(func() { close(duplicateConnectStarted) })
				return nil
			}}, nil
		}
	}

	app := newDatabaseCacheConcurrencyTestApp()
	forgetHeldCacheLock := make(chan bool, 1)
	app.dbConnectBeforeForgetHook = func() {
		if app.mu.TryLock() {
			app.mu.Unlock()
			forgetHeldCacheLock <- false
			return
		}
		forgetHeldCacheLock <- true
	}
	config := connection.ConnectionConfig{Type: "sqlite", Host: t.TempDir() + "/forget-aba.sqlite"}

	firstDone := make(chan error, 1)
	go func() {
		_, err := app.getDatabaseWithPing(config, false)
		firstDone <- err
	}()
	select {
	case <-firstConnectStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for old singleflight")
	}
	if result := app.DBReleaseConnection(config); !result.Success {
		close(releaseFirstConnect)
		<-firstDone
		t.Fatalf("DBReleaseConnection failed: %s", result.Message)
	}
	if held := <-forgetHeldCacheLock; !held {
		close(releaseFirstConnect)
		<-firstDone
		t.Fatal("singleflight Forget ran after releasing the cache lock, reopening the ABA window")
	}

	secondDone := make(chan struct {
		instance db.Database
		err      error
	}, 1)
	go func() {
		instance, err := app.getDatabaseWithPing(config, false)
		secondDone <- struct {
			instance db.Database
			err      error
		}{instance: instance, err: err}
	}()
	select {
	case <-secondConnectStarted:
	case <-time.After(2 * time.Second):
		close(releaseFirstConnect)
		<-firstDone
		t.Fatal("timed out waiting for fresh singleflight")
	}

	// Let the forgotten old group finish only after the fresh group exists. It
	// must neither remove nor split the fresh group.
	close(releaseFirstConnect)
	if err := <-firstDone; !errors.Is(err, errDatabaseConnectionReleased) {
		close(releaseSecondConnect)
		<-secondDone
		t.Fatalf("expected old flight to remain released, got %v", err)
	}

	const followers = 16
	results := make(chan struct {
		instance db.Database
		err      error
	}, followers)
	start := make(chan struct{})
	for range followers {
		go func() {
			<-start
			instance, err := app.getDatabaseWithPing(config, false)
			results <- struct {
				instance db.Database
				err      error
			}{instance: instance, err: err}
		}()
	}
	close(start)
	for range 32 {
		runtime.Gosched()
	}
	select {
	case <-duplicateConnectStarted:
		close(releaseSecondConnect)
		<-secondDone
		for range followers {
			<-results
		}
		t.Fatal("fresh singleflight was forgotten and split into duplicate physical connects")
	default:
	}
	close(releaseSecondConnect)
	secondResult := <-secondDone
	if secondResult.err != nil || secondResult.instance != secondDB {
		t.Fatalf("fresh leader failed: instance=%p err=%v", secondResult.instance, secondResult.err)
	}
	for range followers {
		result := <-results
		if result.err != nil || result.instance != secondDB {
			t.Fatalf("fresh follower failed: instance=%p err=%v", result.instance, result.err)
		}
	}
	if got := factoryCalls.Load(); got != 2 {
		t.Fatalf("expected exactly two physical flights across release, got %d", got)
	}
}
