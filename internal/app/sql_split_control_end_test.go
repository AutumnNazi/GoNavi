package app

import (
	"reflect"
	"strings"
	"testing"
)

// These payloads are also asserted at QueryEditor's RPC boundary in
// frontend/src/components/QueryEditor.mysql-delimiter-run.test.tsx.
const mysqlWhileProcedureRPC = "CREATE PROCEDURE p()\nBEGIN\n  WHILE x > 0 DO\n    SET x = x - 1;\n  END WHILE;\nEND"

func TestSplitSQLStatementsMySQLQueryEditorRPCPayload(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  []string
	}{
		{
			name:  "full run and complete script selection",
			query: "DROP PROCEDURE IF EXISTS p;\n" + mysqlWhileProcedureRPC + ";\nCALL p()",
			want:  []string{"DROP PROCEDURE IF EXISTS p", mysqlWhileProcedureRPC + ";", "CALL p()"},
		},
		{
			name:  "cursor run and body selection",
			query: mysqlWhileProcedureRPC,
			want:  []string{mysqlWhileProcedureRPC},
		},
	}
	for _, dbType := range []string{"mysql", "mariadb", " MySQL "} {
		for _, tt := range tests {
			t.Run(dbType+"/"+tt.name, func(t *testing.T) {
				got := splitSQLStatementsForDialect(dbType, tt.query)
				if !reflect.DeepEqual(got, tt.want) {
					t.Fatalf("split RPC SQL = %#v, want %#v", got, tt.want)
				}
			})
		}
	}
}

func TestSplitSQLStatementsMySQLNestedRoutineControls(t *testing.T) {
	bodies := []string{
		mysqlWhileProcedureRPC,
		"CREATE PROCEDURE p()\nBEGIN\n  REPEAT\n    SET x = x - 1;\n  UNTIL x <= 0 END REPEAT;\nEND",
		strings.Join([]string{
			"CREATE PROCEDURE p()", "BEGIN",
			"  outer_loop: WHILE x > 0 DO", "    REPEAT", "      BEGIN",
			"        SET x = CASE WHEN x > 1 THEN x - 1 ELSE 0 END;", "      END;",
			"    UNTIL x <= 0 END REPEAT;", "  END /* loop ends, not BEGIN */ WHILE outer_loop;",
			"  SET @finished = 1;", "END",
		}, "\n"),
		strings.Join([]string{
			"CREATE PROCEDURE p()", "BEGIN",
			"  SET @label = 'END WHILE; END REPEAT;';", "  -- END WHILE;", "  # END REPEAT;",
			"  WHILE x > 0 DO", "    SET x = x - 1;", "  end /* between keywords */ wHiLe;",
			"  SET @finished = 1;", "END",
		}, "\n"),
		"CREATE PROCEDURE p()\nBEGIN\n  WHILE x > 0 DO\n    SET x = x - 1;\n  END -- suffix on next line\n  WHILE;\nEND",
	}
	for _, dbType := range []string{"mysql", "mariadb"} {
		for _, body := range bodies {
			t.Run(dbType+"/"+body, func(t *testing.T) {
				query := body + ";\nSELECT 2;"
				want := []string{body + ";", "SELECT 2"}
				if got := splitSQLStatementsForDialect(dbType, query); !reflect.DeepEqual(got, want) {
					t.Fatalf("split routine = %#v, want %#v", got, want)
				}
				for _, chunkSize := range []int{1, 7, len(query)} {
					splitter := &sqlStreamSplitter{dbType: dbType}
					var got []string
					for index := 0; index < len(query); index += chunkSize {
						got = append(got, splitter.Feed([]byte(query[index:min(index+chunkSize, len(query))]))...)
					}
					got = append(got, splitter.flushStatements()...)
					if !reflect.DeepEqual(got, want) {
						t.Fatalf("stream split with chunk size %d = %#v, want %#v", chunkSize, got, want)
					}
				}
			})
		}
	}
}

func TestSplitSQLStatementsMySQLControlEndDialectBoundary(t *testing.T) {
	for _, dbType := range []string{"oracle", "postgres", "sqlserver", "iris", "cache", ""} {
		t.Run(dbType, func(t *testing.T) {
			body := "CREATE PROCEDURE repeat() AS\nBEGIN\n  NULL;\nEND repeat;"
			want := []string{body, "SELECT 2"}
			if got := splitSQLStatementsForDialect(dbType, body+"\nSELECT 2;"); !reflect.DeepEqual(got, want) {
				t.Fatalf("non-MySQL named routine = %#v, want %#v", got, want)
			}
		})
	}
	for _, dbType := range []string{"mysql", "mariadb"} {
		for _, label := range []string{"while_label", "repeat_label", "`while`", "`repeat`"} {
			t.Run(dbType+"/"+label, func(t *testing.T) {
				body := "BEGIN\n  SET @x = 1;\nEND " + label + ";"
				want := []string{body, "SELECT 2"}
				if got := splitSQLStatementsForDialect(dbType, body+"\nSELECT 2;"); !reflect.DeepEqual(got, want) {
					t.Fatalf("named block = %#v, want %#v", got, want)
				}
			})
		}
	}
}
