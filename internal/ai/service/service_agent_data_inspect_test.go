package aiservice

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestInspectClosedAgentLedgerReadsFileURI(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent_runs.sqlite")
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`CREATE TABLE sessions (id TEXT)`,
		`CREATE TABLE runs (id TEXT, state TEXT)`,
		`CREATE TABLE workspace_snapshots (id TEXT)`,
		`INSERT INTO sessions (id) VALUES ('session-1')`,
		`INSERT INTO runs (id, state) VALUES ('run-1', 'completed')`,
	} {
		if _, err := database.Exec(statement); err != nil {
			_ = database.Close()
			t.Fatal(err)
		}
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	stats, err := inspectClosedAgentLedger(path)
	if err != nil {
		t.Fatalf("inspect closed ledger: %v", err)
	}
	if stats.SessionCount != 1 || stats.RunCount != 1 || stats.ActiveRunCount != 0 || stats.SnapshotCount != 0 {
		t.Fatalf("stats = %+v", stats)
	}
	if stats.FileBytes == 0 || stats.AllocatedBytes == 0 {
		t.Fatalf("stats missing file size: %+v", stats)
	}
}
