package db

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"sync"
	"testing"
	"time"
)

const metadataContextDriverName = "gonavi_metadata_context_test"

var (
	registerMetadataContextDriver sync.Once
	metadataContextDriverState    struct {
		sync.Mutex
		contexts chan context.Context
	}
)

type metadataContextDriver struct{}

func (metadataContextDriver) Open(string) (driver.Conn, error) {
	return metadataContextConn{}, nil
}

type metadataContextConn struct{}

func (metadataContextConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("不支持 Prepare")
}

func (metadataContextConn) Close() error { return nil }

func (metadataContextConn) Begin() (driver.Tx, error) {
	return nil, errors.New("不支持事务")
}

func (metadataContextConn) QueryContext(ctx context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
	metadataContextDriverState.Lock()
	contexts := metadataContextDriverState.contexts
	metadataContextDriverState.Unlock()
	if contexts != nil {
		contexts <- ctx
	}
	<-ctx.Done()
	return nil, ctx.Err()
}

var _ driver.QueryerContext = metadataContextConn{}

func TestMySQLMetadataQueryUsesRequestContext(t *testing.T) {
	registerMetadataContextDriver.Do(func() {
		sql.Register(metadataContextDriverName, metadataContextDriver{})
	})

	contexts := make(chan context.Context, 1)
	metadataContextDriverState.Lock()
	metadataContextDriverState.contexts = contexts
	metadataContextDriverState.Unlock()
	t.Cleanup(func() {
		metadataContextDriverState.Lock()
		metadataContextDriverState.contexts = nil
		metadataContextDriverState.Unlock()
	})

	conn, err := sql.Open(metadataContextDriverName, "")
	if err != nil {
		t.Fatalf("打开测试连接失败：%v", err)
	}
	defer conn.Close()
	database := &MySQLDB{conn: conn}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	BindMetadataContext(database, ctx)
	defer ClearMetadataContext(database)

	resultCh := make(chan error, 1)
	go func() {
		_, queryErr := database.GetTables("app")
		resultCh <- queryErr
	}()

	select {
	case queryCtx := <-contexts:
		if queryCtx != ctx {
			t.Fatal("MySQL 元数据查询未使用请求上下文")
		}
	case <-time.After(time.Second):
		t.Fatal("MySQL 元数据查询未到达 QueryContext")
	}

	cancel()
	select {
	case queryErr := <-resultCh:
		if !errors.Is(queryErr, context.Canceled) {
			t.Fatalf("取消后的查询错误 = %v，期望 context.Canceled", queryErr)
		}
	case <-time.After(time.Second):
		t.Fatal("MySQL 元数据查询未因取消而退出")
	}
}

func TestMySQLMetadataColumnsQueryUsesRequestContext(t *testing.T) {
	registerMetadataContextDriver.Do(func() {
		sql.Register(metadataContextDriverName, metadataContextDriver{})
	})

	contexts := make(chan context.Context, 1)
	metadataContextDriverState.Lock()
	metadataContextDriverState.contexts = contexts
	metadataContextDriverState.Unlock()
	t.Cleanup(func() {
		metadataContextDriverState.Lock()
		metadataContextDriverState.contexts = nil
		metadataContextDriverState.Unlock()
	})

	conn, err := sql.Open(metadataContextDriverName, "")
	if err != nil {
		t.Fatalf("打开测试连接失败：%v", err)
	}
	defer conn.Close()
	database := &MySQLDB{conn: conn}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	BindMetadataContext(database, ctx)
	defer ClearMetadataContext(database)

	resultCh := make(chan error, 1)
	go func() {
		_, queryErr := database.GetColumns("app", "orders")
		resultCh <- queryErr
	}()

	select {
	case queryCtx := <-contexts:
		if queryCtx != ctx {
			t.Fatal("MySQL 列元数据查询未使用请求上下文")
		}
	case <-time.After(time.Second):
		t.Fatal("MySQL 列元数据查询未到达 QueryContext")
	}

	cancel()
	select {
	case queryErr := <-resultCh:
		if !errors.Is(queryErr, context.Canceled) {
			t.Fatalf("取消后的列元数据查询错误 = %v，期望 context.Canceled", queryErr)
		}
	case <-time.After(time.Second):
		t.Fatal("MySQL 列元数据查询未因取消而退出")
	}
}
