package app

import (
	"context"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestInspectSourceRefusesSQLAndIncompleteReads(t *testing.T) {
	app := &App{}
	ctx := context.Background()
	sql := app.InspectSource(ctx, connection.ConnectionConfig{Type: "mysql"}, SourceInspectQuery{Kind: "list_entries"})
	if sql.Success || !strings.Contains(sql.Message, "SQL") {
		t.Fatalf("sql result = %+v", sql)
	}
	nacos := app.InspectSource(ctx, connection.ConnectionConfig{Type: "nacos"}, SourceInspectQuery{Kind: "get_entry", Group: "DEFAULT_GROUP"})
	if nacos.Success || !strings.Contains(nacos.Message, "dataId") {
		t.Fatalf("nacos result = %+v", nacos)
	}
	redis := app.InspectSource(ctx, connection.ConnectionConfig{Type: "redis"}, SourceInspectQuery{Kind: "get_entry"})
	if redis.Success || !strings.Contains(redis.Message, "key") {
		t.Fatalf("redis result = %+v", redis)
	}
	vector := app.InspectSource(ctx, connection.ConnectionConfig{Type: "milvus"}, SourceInspectQuery{Kind: "get_entry"})
	if vector.Success || !strings.Contains(vector.Message, "list_entries") {
		t.Fatalf("vector result = %+v", vector)
	}
}
