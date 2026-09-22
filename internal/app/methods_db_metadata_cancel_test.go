package app

import (
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

func TestMetadataWithCancelReachesContextAwareDriver(t *testing.T) {
	installMetadataSessionTestHooks(t)
	instance := newContextAwareMetadataDB()
	newDatabaseFunc = func(string) (db.Database, error) { return instance, nil }
	application := newDatabaseCacheConcurrencyTestApp()
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, Database: "app"}

	resultCh := make(chan connection.QueryResult, 1)
	go func() {
		resultCh <- application.DBGetTablesWithCancel(config, "app", "metadata-context-query")
	}()
	waitForContext(t, instance.started, "带取消 ID 的元数据查询未启动")
	if result := application.CancelQuery("metadata-context-query"); !result.Success {
		t.Fatalf("CancelQuery returned failure: %#v", result)
	}

	select {
	case result := <-resultCh:
		if result.Success {
			t.Fatalf("取消的元数据请求意外成功：%#v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("带取消 ID 的元数据请求未及时返回")
	}
	waitForMetadataSignal(t, instance.done, "驱动未收到元数据取消 context")
	waitForMetadataSignal(t, instance.closeDone, "取消后未关闭隔离数据库")
}

func TestMetadataWithCancelDoesNotFakeLegacyConnectCompletion(t *testing.T) {
	installMetadataSessionTestHooks(t)
	instance := newBlockingConnectMetadataDB()
	newDatabaseFunc = func(string) (db.Database, error) { return instance, nil }
	application := newDatabaseCacheConcurrencyTestApp()
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, Database: "app"}

	resultCh := make(chan connection.QueryResult, 1)
	go func() {
		resultCh <- application.DBGetTablesWithCancel(config, "app", "metadata-legacy-connect")
	}()
	waitForMetadataSignal(t, instance.connectStarted, "旧驱动元数据连接未启动")
	if result := application.CancelQuery("metadata-legacy-connect"); !result.Success {
		t.Fatalf("CancelQuery returned failure: %#v", result)
	}

	select {
	case result := <-resultCh:
		t.Fatalf("旧驱动连接仍阻塞时 RPC 被伪装成已结束：%#v", result)
	case <-time.After(50 * time.Millisecond):
	}

	close(instance.releaseConnect)
	select {
	case result := <-resultCh:
		if result.Success {
			t.Fatalf("取消的旧驱动元数据请求意外成功：%#v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("旧驱动连接释放后元数据请求未返回")
	}
}
