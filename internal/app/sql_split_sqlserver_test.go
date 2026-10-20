package app

import (
	"reflect"
	"strings"
	"testing"
)

func TestSplitSQLStatementsForDialect_DropsSQLServerGoBatchSeparator(t *testing.T) {
	input := strings.Join([]string{
		"CREATE TABLE demo(id int)",
		"GO",
		"INSERT INTO demo(id) VALUES (1);",
		"GO",
	}, "\n")

	got := splitSQLStatementsForDialect("sqlserver", input)
	want := []string{
		"CREATE TABLE demo(id int)",
		"INSERT INTO demo(id) VALUES (1)",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("splitSQLStatementsForDialect(sqlserver) = %#v, want %#v", got, want)
	}
}

func TestSplitSQLStatementsForDialect_KeepsSQLServerControlFlowBatchTogether(t *testing.T) {
	input := strings.Join([]string{
		"-- 每酒店调用 PMS Open API 的凭证（可重复执行）",
		"IF OBJECT_ID(N'dbo.ch_pms_credential', N'U') IS NULL",
		"BEGIN",
		"	CREATE TABLE dbo.ch_pms_credential (",
		"		id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY",
		"	);",
		"	CREATE UNIQUE INDEX UX_ch_pms_credential_hotel",
		"		ON dbo.ch_pms_credential(id) WHERE id IS NULL;",
		"END",
		"GO",
	}, "\n")

	got := splitSQLStatementsForDialect("sqlserver", input)
	if len(got) != 1 {
		t.Fatalf("statement count = %d, want 1 (%#v)", len(got), got)
	}
	if strings.Contains(got[0], "GO") {
		t.Fatalf("GO must not reach the server, got %q", got[0])
	}
	if !strings.Contains(got[0], "CREATE UNIQUE INDEX") {
		t.Fatalf("batch body lost the index statement: %q", got[0])
	}
}

func TestSplitSQLStatementsForDialect_ExpandsSQLServerGoRepeat(t *testing.T) {
	input := "INSERT INTO demo(id) VALUES (1)\nGO 3\n"

	got := splitSQLStatementsForDialect("sqlserver", input)
	want := []string{
		"INSERT INTO demo(id) VALUES (1)",
		"INSERT INTO demo(id) VALUES (1)",
		"INSERT INTO demo(id) VALUES (1)",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("GO 3 expansion = %#v, want %#v", got, want)
	}
}

func TestSplitSQLStatementsForDialect_SQLServerGoOnlyAtLineStart(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{
			name:  "inline go stays inside the statement",
			input: "SELECT 1 GO SELECT 2;",
			want:  []string{"SELECT 1 GO SELECT 2"},
		},
		{
			name:  "identifier go is not a separator",
			input: "SELECT go FROM t; SELECT 2;",
			want:  []string{"SELECT go FROM t", "SELECT 2"},
		},
		{
			name:  "go inside a string literal is content",
			input: "SELECT 'GO' AS marker; SELECT 2;",
			want:  []string{"SELECT 'GO' AS marker", "SELECT 2"},
		},
		{
			name:  "go inside a comment is content",
			input: "SELECT 1 /* GO */; SELECT 2;",
			want:  []string{"SELECT 1 /* GO */", "SELECT 2"},
		},
		{
			name:  "go with a trailing comment is a separator",
			input: "SELECT 1\nGO -- run the batch\nSELECT 2",
			want:  []string{"SELECT 1", "SELECT 2"},
		},
		{
			name:  "go with an indented line is a separator",
			input: "SELECT 1\n   GO\nSELECT 2",
			want:  []string{"SELECT 1", "SELECT 2"},
		},
		{
			name:  "go n with zero or garbage is not a separator",
			input: "SELECT 1\nGO 0\nSELECT 2",
			want:  []string{"SELECT 1\nGO 0\nSELECT 2"},
		},
		{
			name:  "go n rejects scientific notation like the Go splitter",
			input: "SELECT 1\nGO 1e2\nSELECT 2",
			want:  []string{"SELECT 1\nGO 1e2\nSELECT 2"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := splitSQLStatementsForDialect("sqlserver", test.input)
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("splitSQLStatementsForDialect(sqlserver, %q) = %#v, want %#v", test.input, got, test.want)
			}
		})
	}
}

func TestSplitSQLStatementsForDialect_GoOnlyAppliesToSQLServer(t *testing.T) {
	input := "SELECT 1\nGO\nSELECT 2"
	got := splitSQLStatementsForDialect("postgres", input)
	want := []string{input}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("postgres must keep GO as text: %#v, want %#v", got, want)
	}
}

func TestSplitSQLStatementsForDialect_DoesNotRepeatPreviousBatchAcrossStatements(t *testing.T) {
	// GO n 只重复它前面那个批次；上一个批次之外的语句不能被复制。
	input := strings.Join([]string{
		"CREATE TABLE a(id int)",
		"GO",
		"INSERT INTO a(id) VALUES (1);",
		"INSERT INTO a(id) VALUES (2);",
		"GO 2",
	}, "\n")

	got := splitSQLStatementsForDialect("sqlserver", input)
	want := []string{
		"CREATE TABLE a(id int)",
		"INSERT INTO a(id) VALUES (1)",
		"INSERT INTO a(id) VALUES (2)",
		"INSERT INTO a(id) VALUES (1)",
		"INSERT INTO a(id) VALUES (2)",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("batch-scoped GO 2 expansion = %#v, want %#v", got, want)
	}
}

func TestSQLServerBatchTextNeedsPerStatement(t *testing.T) {
	tests := []struct {
		name   string
		dbType string
		query  string
		want   bool
	}{
		{name: "sqlserver with GO", dbType: "sqlserver", query: "SELECT 1\nGO\nSELECT 2", want: true},
		{name: "sqlserver without GO", dbType: "sqlserver", query: "SELECT 1; SELECT 2", want: false},
		{name: "sqlserver with inline go", dbType: "sqlserver", query: "SELECT 1 GO SELECT 2", want: false},
		{name: "other dialect with GO", dbType: "postgres", query: "SELECT 1\nGO\nSELECT 2", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := sqlServerBatchTextNeedsPerStatement(test.dbType, test.query); got != test.want {
				t.Fatalf("sqlServerBatchTextNeedsPerStatement(%q, %q) = %v, want %v", test.dbType, test.query, got, test.want)
			}
		})
	}
}
