package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

// 导出链路曾在入口处比对 driver-agent revision，不一致直接拒绝导出。
// revision 只是「建议重装」的信号：旧 agent 仍能正常连库与查询（流式不支持时
// 会自动回退缓冲模式），因此任何入口都不得因 revision 漂移阻断导出。
func TestExportQueryToPathAllowsStaleOptionalDriverAgentRevision(t *testing.T) {
	originalProbe := optionalDriverAgentMetadataProbe
	t.Cleanup(func() {
		optionalDriverAgentMetadataProbe = originalProbe
	})
	optionalDriverAgentMetadataProbe = func(driverType string, executablePath string) (db.OptionalDriverAgentMetadata, error) {
		return db.OptionalDriverAgentMetadata{
			DriverType:    driverType,
			AgentRevision: "src-stale-agent",
		}, nil
	}
	db.SetExternalDriverDownloadDirectory(t.TempDir())
	t.Cleanup(func() {
		db.SetExternalDriverDownloadDirectory("")
	})

	runtime, err := NewHeadlessRuntime(context.Background(), HeadlessRuntimeOptions{DataRoot: t.TempDir()})
	if err != nil {
		t.Fatalf("NewHeadlessRuntime: %v", err)
	}
	defer runtime.Close()
	database := &sqlAuditTestDatabase{
		rows:    []map[string]interface{}{{"id": int64(1)}},
		columns: []string{"id"},
	}
	installHeadlessTestDatabase(t, database)

	outputPath := filepath.Join(t.TempDir(), "export.json")
	result := runtime.ExportQueryToPath(
		context.Background(),
		connection.ConnectionConfig{Type: "sqlserver", Host: "127.0.0.1", Port: 1433},
		"app",
		"SELECT id FROM demo",
		outputPath,
		ExportFileOptions{Format: "json"},
		false,
	)
	if !result.Success {
		t.Fatalf("stale driver-agent revision must not block export, got %#v", result)
	}
	if !database.connected {
		t.Fatal("export did not open the database")
	}
	content, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("read export file: %v", err)
	}
	var rows []map[string]interface{}
	if err := json.Unmarshal(content, &rows); err != nil {
		t.Fatalf("export file is not a JSON array: %v\n%s", err, content)
	}
	if len(rows) != 1 {
		t.Fatalf("expected one exported row, got %d: %s", len(rows), content)
	}
}
