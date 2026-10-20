package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

func TestPinSQLFileImportDatabaseRewritesOnlyWholeUseStatements(t *testing.T) {
	tests := []struct {
		name     string
		dbType   string
		stmt     string
		database string
		want     string
	}{
		{
			name:     "mysql backtick use",
			dbType:   "mysql",
			stmt:     "USE `igap`",
			database: "igap_pro",
			want:     "USE `igap_pro`",
		},
		{
			name:     "mysql plain use with comment",
			dbType:   "mysql",
			stmt:     "-- Current Database: `igap`\nUSE igap;",
			database: "igap_pro",
			want:     "USE `igap_pro`",
		},
		{
			name:     "sqlserver bracket use",
			dbType:   "sqlserver",
			stmt:     "USE [igap]",
			database: "igap_pro",
			want:     "USE [igap_pro]",
		},
		{
			name:     "create database stays",
			dbType:   "mysql",
			stmt:     "CREATE DATABASE /*!32312 IF NOT EXISTS*/ `igap`",
			database: "igap_pro",
			want:     "CREATE DATABASE /*!32312 IF NOT EXISTS*/ `igap`",
		},
		{
			name:     "use inside procedure stays",
			dbType:   "mysql",
			stmt:     "CREATE PROCEDURE p() BEGIN USE `igap`; END",
			database: "igap_pro",
			want:     "CREATE PROCEDURE p() BEGIN USE `igap`; END",
		},
		{
			name:     "string literal stays",
			dbType:   "mysql",
			stmt:     "SELECT 'USE `igap`'",
			database: "igap_pro",
			want:     "SELECT 'USE `igap`'",
		},
		{
			name:     "postgres does not rewrite use",
			dbType:   "postgres",
			stmt:     "USE igap",
			database: "igap_pro",
			want:     "USE igap",
		},
		{
			name:     "empty target keeps file use",
			dbType:   "mysql",
			stmt:     "USE `igap`",
			database: "  ",
			want:     "USE `igap`",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := pinSQLFileImportDatabase(test.dbType, test.stmt, test.database)
			if got != test.want {
				t.Fatalf("pinSQLFileImportDatabase() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestExecuteSQLFileStreamUsesPinnedDatabaseInsteadOfFileUse(t *testing.T) {
	fakeDB := &fakeSQLFileBatchDB{}
	input := strings.Join([]string{
		"-- Current Database: `igap`",
		"CREATE DATABASE /*!32312 IF NOT EXISTS*/ `igap` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;",
		"USE `igap`;",
		"CREATE TABLE `t_annual_adjust`(id INT);",
		"USE `other`;",
		"INSERT INTO `t_annual_adjust`(id) VALUES (1);",
	}, "\n")

	result, err := executeSQLFileStream(context.Background(), fakeDB, strings.NewReader(input), sqlFileExecutionOptions{
		DBType:      "mysql",
		PinDatabase: "igap_pro",
	}, nil)
	if err != nil {
		t.Fatalf("executeSQLFileStream returned error: %v", err)
	}
	if result.Executed != 5 || result.Failed != 0 {
		t.Fatalf("expected every statement to run against the pinned database, got %#v", result)
	}
	useCount := 0
	for _, query := range fakeDB.execQueries {
		switch query {
		case "USE `igap`", "USE `other`", "USE igap", "USE other":
			t.Fatalf("file USE switched the session, queries=%#v", fakeDB.execQueries)
		case "USE `igap_pro`":
			useCount++
		}
	}
	if useCount != 2 {
		t.Fatalf("expected both USE statements to target igap_pro, queries=%#v", fakeDB.execQueries)
	}
	joined := strings.Join(append(append([]string{}, fakeDB.execQueries...), fakeDB.batchQueries...), "\n")
	if !strings.Contains(joined, "CREATE TABLE `t_annual_adjust`(id INT)") {
		t.Fatalf("table statement was not executed, queries=%#v batches=%#v", fakeDB.execQueries, fakeDB.batchQueries)
	}
}

func TestImportDatabaseSQLPinsSelectedDatabaseOverFileUse(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "igap.sql")
	content := strings.Join([]string{
		"-- Current Database: `igap`",
		"CREATE DATABASE IF NOT EXISTS `igap`;",
		"USE `igap`;",
		"CREATE TABLE `t_annual_adjust`(id INT);",
	}, "\n")
	if err := os.WriteFile(filePath, []byte(content), 0o600); err != nil {
		t.Fatalf("write SQL import fixture: %v", err)
	}

	originalNewDatabaseFunc := newDatabaseFunc
	t.Cleanup(func() { newDatabaseFunc = originalNewDatabaseFunc })
	fakeDB := &fakeSQLFileBatchDB{}
	newDatabaseFunc = func(string) (db.Database, error) {
		return fakeDB, nil
	}

	app := NewApp()
	app.configDir = t.TempDir()
	result := app.ImportDatabaseSQL(connection.ConnectionConfig{Type: "mysql"}, "igap_pro", filePath, "pin-import-database", false)
	if !result.Success {
		t.Fatalf("ImportDatabaseSQL returned failure: %#v", result)
	}
	for _, query := range fakeDB.execQueries {
		if query == "USE `igap`" {
			t.Fatalf("import followed the SQL file database, queries=%#v", fakeDB.execQueries)
		}
	}
	foundPinnedUse := false
	for _, query := range fakeDB.execQueries {
		if query == "USE `igap_pro`" {
			foundPinnedUse = true
		}
	}
	if !foundPinnedUse {
		t.Fatalf("import did not pin the selected database, queries=%#v", fakeDB.execQueries)
	}
}
