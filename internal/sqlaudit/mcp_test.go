package sqlaudit

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestMCPAuditRoundTripAndHistory(t *testing.T) {
	store := openTestStore(t)
	for index, source := range []string{"query_editor", "mcp", "ai_action"} {
		event := sampleEvent(fmt.Sprint(index), 0)
		event.Source = source
		event = ApplyMCPContext(event, MCPContext{RequestID: "request-1", Client: "client-1"})
		if err := store.Append(event); err != nil {
			t.Fatal(err)
		}
	}
	for _, test := range []struct {
		name   string
		filter Filter
		want   int64
	}{
		{"default", Filter{ExecutionHistory: true}, 1},
		{"include MCP", Filter{ExecutionHistory: true, IncludeMCP: true}, 2},
		{"only MCP", Filter{ExecutionHistory: true, IncludeMCP: true, Source: "mcp"}, 1},
		{"request", Filter{MCPRequestID: "request-1"}, 1},
		{"unknown request", Filter{MCPRequestID: "missing"}, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			page, err := store.Query(test.filter)
			if err != nil || page.Total != test.want {
				t.Fatalf("page=%+v err=%v", page, err)
			}
		})
	}
	page, err := store.Query(Filter{MCPRequestID: "request-1"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Items[0].MCPClient != "client-1" {
		t.Fatalf("context lost: %+v", page.Items[0])
	}
	for _, format := range []string{"json", "csv"} {
		data, err := store.BuildExport(Filter{MCPRequestID: "request-1"}, format)
		if err != nil || !strings.Contains(string(data), "request-1") {
			t.Fatalf("export %s: %s %v", format, data, err)
		}
	}
	report, err := store.VerifyIntegrity()
	if err != nil || !report.Valid {
		t.Fatalf("integrity=%+v err=%v", report, err)
	}
	if _, err := store.db.Exec(`UPDATE sql_audit_events SET mcp_client='changed' WHERE source='mcp'`); err != nil {
		t.Fatal(err)
	}
	report, err = store.VerifyIntegrity()
	if err != nil || report.Valid {
		t.Fatalf("context tampering undetected: %+v %v", report, err)
	}
}

func TestMCPContextIsolationAndRedaction(t *testing.T) {
	base := context.Background()
	ctx := WithMCPContext(base, MCPContext{RequestID: "one", Client: "client"})
	if MCPContextFrom(base).RequestID != "" || MCPContextFrom(nil).RequestID != "" || MCPContextFrom(ctx).RequestID != "one" {
		t.Fatal("request context isolation failed")
	}
	store := openTestStore(t)
	event := sampleEvent("redacted", 0)
	event.Source, event.MCPRequestID, event.MCPClient = "mcp", "request", "password=private-secret"
	if err := store.UpdateSettings(Settings{Enabled: true, CaptureMode: CaptureModeMetadata}); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(event); err != nil {
		t.Fatal(err)
	}
	page, err := store.Query(Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Items[0].SQLText != "" || strings.Contains(page.Items[0].MCPClient, "private-secret") {
		t.Fatalf("sensitive context persisted: %+v", page.Items[0])
	}
}

// 两个独立进程同时升级旧存储并写入，覆盖 SQLite 跨进程锁及链头竞争。
func TestMCPAuditMultipleProcesses(t *testing.T) {
	if path := os.Getenv("GONAVI_TEST_AUDIT_PATH"); path != "" {
		store, err := Open(path)
		if err != nil {
			t.Fatal(err)
		}
		defer func() {
			if err := store.Close(); err != nil {
				t.Error(err)
			}
		}()
		for index := range 40 {
			event := sampleEvent(fmt.Sprintf("%d-%d", os.Getpid(), index), 0)
			event.Source = "mcp"
			event.MCPRequestID = fmt.Sprintf("request-%d-%d", os.Getpid(), index)
			if err := store.Append(event); err != nil {
				t.Fatal(err)
			}
		}
		return
	}
	path := filepath.Join(t.TempDir(), "audit.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(sampleEvent("legacy", 0)); err != nil {
		t.Fatal(err)
	}
	// 模拟 v2：旧记录哈希不包含新增的可选字段，升级不得重写旧链。
	for _, sql := range []string{"DROP INDEX idx_sql_audit_events_mcp_request", "ALTER TABLE sql_audit_events DROP COLUMN mcp_request_id", "ALTER TABLE sql_audit_events DROP COLUMN mcp_client", "PRAGMA user_version=2"} {
		if _, err := store.db.Exec(sql); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	commands := make([]*exec.Cmd, 2)
	for index := range commands {
		command := exec.Command(os.Args[0], "-test.run=^TestMCPAuditMultipleProcesses$", "-test.timeout=45s")
		command.Env = append(os.Environ(), "GONAVI_TEST_AUDIT_PATH="+path)
		command.Stdout, command.Stderr = os.Stdout, os.Stderr
		commands[index] = command
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
	}
	for _, command := range commands {
		if err := command.Wait(); err != nil {
			t.Error(err)
		}
	}
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	}()
	page, err := store.Query(Filter{})
	if err != nil || page.Total != 81 {
		t.Fatalf("lost events: total=%d err=%v", page.Total, err)
	}
	report, err := store.VerifyIntegrity()
	if err != nil || !report.Valid || report.CheckedRecords != 81 {
		t.Fatalf("integrity=%+v err=%v", report, err)
	}
}
