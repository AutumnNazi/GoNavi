//go:build gonavi_full_drivers || gonavi_kingbase_driver

package db

import (
	"reflect"
	"testing"
)

func TestSplitKingbaseSimpleQueryStatementsKeepsQuotedAndDollarSemicolons(t *testing.T) {
	query := "INSERT INTO t(note) VALUES ('a;b');\n" +
		"DO $body$\n" +
		"BEGIN\n" +
		"  PERFORM 1;\n" +
		"END\n" +
		"$body$;\n" +
		"-- keep; this comment\n" +
		"INSERT INTO t(name) VALUES (\"x;y\")"

	got := splitKingbaseSimpleQueryStatements(query)
	want := []string{
		"INSERT INTO t(note) VALUES ('a;b')",
		"DO $body$\nBEGIN\n  PERFORM 1;\nEND\n$body$",
		"-- keep; this comment\nINSERT INTO t(name) VALUES (\"x;y\")",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("splitKingbaseSimpleQueryStatements() = %#v, want %#v", got, want)
	}
}

func TestSplitKingbaseSimpleQueryStatementsSplitsScreenshotInserts(t *testing.T) {
	query := "insert into ldf_server.sys_config values ('不良上报工步编码', 'ng_report');\n" +
		"insert into ldf_server.md_step values ('ng_report', '不良上报');"

	got := splitKingbaseSimpleQueryStatements(query)
	if len(got) != 2 {
		t.Fatalf("statement count = %d, want 2: %#v", len(got), got)
	}
	if got[0] != "insert into ldf_server.sys_config values ('不良上报工步编码', 'ng_report')" {
		t.Fatalf("first statement = %q", got[0])
	}
	if got[1] != "insert into ldf_server.md_step values ('ng_report', '不良上报')" {
		t.Fatalf("second statement = %q", got[1])
	}
}
