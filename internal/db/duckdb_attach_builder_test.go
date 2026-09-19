package db

import "testing"

func TestBuildDuckDBAttachStatement(t *testing.T) {
	cases := []struct {
		name string
		spec ExternalAttachSpec
		want string
	}{
		{
			name: "mysql read only",
			spec: ExternalAttachSpec{Kind: ExternalAttachKindMySQL, Database: "orders", Alias: "a", SecretName: "s1", ReadOnly: true},
			want: "ATTACH 'orders' AS a (TYPE MYSQL, SECRET s1, READ_ONLY)",
		},
		{
			name: "mysql read write with quote escaping",
			spec: ExternalAttachSpec{Kind: ExternalAttachKindMySQL, Database: "or'ders", Alias: "a", SecretName: "s1"},
			want: "ATTACH 'or''ders' AS a (TYPE MYSQL, SECRET s1)",
		},
		{
			name: "postgres uses secret database and empty path",
			spec: ExternalAttachSpec{Kind: ExternalAttachKindPostgres, Database: "warehouse", Alias: "pg", SecretName: "s2", ReadOnly: true},
			want: "ATTACH '' AS pg (TYPE POSTGRES, SECRET s2, READ_ONLY)",
		},
		{
			name: "sqlite file",
			spec: ExternalAttachSpec{Kind: ExternalAttachKindSQLite, FilePath: "D:/data/x.db", Alias: "lite"},
			want: "ATTACH 'D:/data/x.db' AS lite (TYPE SQLITE)",
		},
		{
			name: "duckdb native read only",
			spec: ExternalAttachSpec{Kind: ExternalAttachKindDuckDB, FilePath: "a.duckdb", Alias: "ext", ReadOnly: true},
			want: "ATTACH 'a.duckdb' AS ext (READ_ONLY)",
		},
		{
			name: "duckdb native read write",
			spec: ExternalAttachSpec{Kind: ExternalAttachKindDuckDB, FilePath: "a.duckdb", Alias: "ext"},
			want: "ATTACH 'a.duckdb' AS ext",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := buildDuckDBAttachStatement(tc.spec); got != tc.want {
				t.Fatalf("statement = %q, want %q", got, tc.want)
			}
		})
	}
}
