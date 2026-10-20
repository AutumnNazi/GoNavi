//go:build gonavi_full_drivers || gonavi_iris_driver || gonavi_cache_driver

package db

import (
	"database/sql/driver"
	"slices"
	"testing"
)

func TestInterSystemsGetDatabasesIncludesSystemNamespacesWhenUnspecified(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name string
		rows [][]driver.Value
		want []string
	}{
		{
			name: "default server namespaces",
			rows: [][]driver.Value{{"USER"}, {"%SYS"}},
			want: []string{"%SYS", "USER"},
		},
		{
			name: "trim deduplicate and sort without hiding system namespaces",
			rows: [][]driver.Value{
				{"USER"}, {" %SYS "}, {"APP"}, {"%sys"},
				{""}, {" "}, {nil}, {"user"}, {"%APP"},
			},
			want: []string{"%APP", "%SYS", "APP", "USER"},
		},
	}

	for _, product := range []interSystemsProduct{interSystemsProductIRIS, interSystemsProductCache} {
		for _, tc := range testCases {
			t.Run(string(product)+"/"+tc.name, func(t *testing.T) {
				t.Parallel()

				conn, state := openOracleRecordingDB(t)
				state.mu.Lock()
				state.queryResults[`SELECT Nsp FROM %SYS.Namespace_List()`] = oracleRecordingQueryResult{
					columns: []string{"Nsp"},
					rows:    tc.rows,
				}
				state.mu.Unlock()

				var database Database
				if product == interSystemsProductCache {
					database = &CacheDB{IrisDB: IrisDB{
						conn: conn, namespace: defaultIRISNamespace, product: product,
					}}
				} else {
					database = &IrisDB{conn: conn, namespace: defaultIRISNamespace}
				}

				namespaces, err := database.GetDatabases()
				if err != nil {
					t.Fatalf("GetDatabases() error = %v", err)
				}
				if !slices.Equal(namespaces, tc.want) {
					t.Fatalf("GetDatabases() = %v, want %v", namespaces, tc.want)
				}
				if queries := state.snapshotQueries(); len(queries) != 1 {
					t.Fatalf("expected one namespace enumeration query, got %v", queries)
				}
			})
		}
	}
}
