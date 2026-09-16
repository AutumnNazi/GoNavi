//go:build gonavi_full_drivers || gonavi_mariadb_driver

package db

import (
	"context"
	"database/sql/driver"
	"slices"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestMariaDBApplyChangesQuotesBacktickIdentifiers(t *testing.T) {
	for _, testCase := range []struct {
		name        string
		tableName   string
		keyColumn   string
		valueColumn string
		wantQueries []string
	}{
		{
			name:        "embedded backticks",
			tableName:   "order`log",
			keyColumn:   "user`id",
			valueColumn: "display`name",
			wantQueries: []string{
				"DELETE FROM `order``log` WHERE `user``id` = ?",
				"UPDATE `order``log` SET `display``name` = ? WHERE `user``id` = ?",
				"INSERT INTO `order``log` (`display``name`) VALUES (?)",
			},
		},
		{
			name:        "ordinary identifiers",
			tableName:   "users",
			keyColumn:   "id",
			valueColumn: "display_name",
			wantQueries: []string{
				"DELETE FROM `users` WHERE `id` = ?",
				"UPDATE `users` SET `display_name` = ? WHERE `id` = ?",
				"INSERT INTO `users` (`display_name`) VALUES (?)",
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			state := &writeOutcomeTransactionState{}
			database := openWriteOutcomeTransactionDB(t, state)

			err := (&MariaDB{conn: database}).ApplyChangesContext(context.Background(), testCase.tableName, connection.ChangeSet{
				Deletes: []map[string]interface{}{{testCase.keyColumn: int64(1)}},
				Updates: []connection.UpdateRow{{
					Keys:   map[string]interface{}{testCase.keyColumn: int64(2)},
					Values: map[string]interface{}{testCase.valueColumn: "updated"},
				}},
				Inserts: []map[string]interface{}{{testCase.valueColumn: "created"}},
			})
			if err != nil {
				t.Fatalf("ApplyChangesContext returned error: %v", err)
			}

			state.mu.Lock()
			queries := append([]string(nil), state.queries...)
			execArgs := append([][]driver.NamedValue(nil), state.execArgs...)
			commits := state.commits
			rollbacks := state.rollbacks
			state.mu.Unlock()

			if !slices.Equal(queries, testCase.wantQueries) {
				t.Fatalf("executed queries = %#v, want %#v", queries, testCase.wantQueries)
			}
			assertMariaDBApplyChangesArgs(t, execArgs, [][]interface{}{
				{int64(1)},
				{"updated", int64(2)},
				{"created"},
			})
			if commits != 1 || rollbacks != 0 {
				t.Fatalf("transaction outcome: commits=%d rollbacks=%d, want commits=1 rollbacks=0", commits, rollbacks)
			}
		})
	}
}

func assertMariaDBApplyChangesArgs(t *testing.T, got [][]driver.NamedValue, want [][]interface{}) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("executed argument groups = %d, want %d", len(got), len(want))
	}
	for queryIndex := range want {
		if len(got[queryIndex]) != len(want[queryIndex]) {
			t.Fatalf("query %d argument count = %d, want %d", queryIndex, len(got[queryIndex]), len(want[queryIndex]))
		}
		for argumentIndex := range want[queryIndex] {
			if got[queryIndex][argumentIndex].Value != want[queryIndex][argumentIndex] {
				t.Fatalf(
					"query %d argument %d = %#v, want %#v",
					queryIndex,
					argumentIndex,
					got[queryIndex][argumentIndex].Value,
					want[queryIndex][argumentIndex],
				)
			}
		}
	}
}
