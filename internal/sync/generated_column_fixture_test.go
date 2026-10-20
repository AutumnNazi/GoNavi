package sync

import (
	"context"
	"fmt"
	"strings"

	"GoNavi-Wails/internal/connection"
)

// generatedColumnDB projects actual SELECT columns from complete source rows.
// Both QueryContext and ExecContext must dispatch here rather than to the embedded fake.
type generatedColumnDB struct {
	fakeQuerySyncTargetDB
	schema          string
	rows            []map[string]interface{}
	execs           []string
	events          []string
	rejectedWrites  int
	execErr         error
	dropOnSchemaAdd bool
}

func generatedColumnColumns(extra string, composite bool) []connection.ColumnDefinition {
	cols := []connection.ColumnDefinition{
		{Name: "id", Type: "bigint", Nullable: "NO", Key: "PRI", Extra: "auto_increment"},
		{Name: "contract_no", Type: "varchar(64)", Nullable: "YES"},
		{Name: "company", Type: "varchar(128)", Nullable: "YES"},
		{Name: "contract_company", Type: "varchar(255)", Nullable: "YES", Extra: extra},
		{Name: "created_at", Type: "timestamp", Nullable: "YES", Extra: "DEFAULT_GENERATED"},
	}
	if composite {
		cols = append(cols, connection.ColumnDefinition{Name: "filing_id", Type: "bigint", Nullable: "NO", Key: "PRI"})
	}
	return cols
}

func newGeneratedColumnDB(schema, extra string, composite bool) *generatedColumnDB {
	return &generatedColumnDB{
		fakeQuerySyncTargetDB: fakeQuerySyncTargetDB{fakeMigrationDB: fakeMigrationDB{
			columns: map[string][]connection.ColumnDefinition{
				schema + ".crm_filing_offline": generatedColumnColumns(extra, composite),
			},
		}},
		schema: schema,
	}
}

func generatedColumnRows(composite bool) []map[string]interface{} {
	rows := []map[string]interface{}{
		{"id": int64(1), "contract_no": "HT-1", "company": "甲公司", "contract_company": "HT-1-甲公司", "created_at": "2026-10-14 10:00:00"},
		{"id": int64(2), "contract_no": "HT-2", "company": "乙公司", "contract_company": "HT-2-乙公司", "created_at": "2026-10-14 11:00:00"},
	}
	if composite {
		for _, row := range rows {
			row["filing_id"] = int64(9)
		}
	}
	return rows
}

func (f *generatedColumnDB) Query(query string) ([]map[string]interface{}, []string, error) {
	f.queryLog = append(f.queryLog, query)
	f.events = append(f.events, "query")
	selectList, _, ok := strings.Cut(strings.TrimPrefix(query, "SELECT "), " FROM ")
	if !ok || !strings.Contains(query, "`"+f.schema+"`.`crm_filing_offline`") {
		return nil, nil, fmt.Errorf("unexpected query: %s", query)
	}
	var names []string
	if selectList == "*" {
		for _, col := range f.columns[f.schema+".crm_filing_offline"] {
			names = append(names, col.Name)
		}
	} else {
		for _, name := range strings.Split(selectList, ", ") {
			names = append(names, strings.Trim(name, "`"))
		}
	}
	rows := make([]map[string]interface{}, 0, len(f.rows))
	for _, row := range f.rows {
		projected := make(map[string]interface{}, len(names))
		for _, name := range names {
			projected[name] = row[name]
		}
		rows = append(rows, projected)
	}
	return rows, names, nil
}

func (f *generatedColumnDB) QueryContext(_ context.Context, query string) ([]map[string]interface{}, []string, error) {
	return f.Query(query)
}

func (f *generatedColumnDB) Exec(query string) (int64, error) {
	f.execs = append(f.execs, query)
	_, definition, ok := strings.Cut(query, " ADD COLUMN `")
	if !ok {
		return 0, fmt.Errorf("unexpected exec: %s", query)
	}
	name, _, ok := strings.Cut(definition, "`")
	if !ok {
		return 0, fmt.Errorf("invalid add column: %s", query)
	}
	f.events = append(f.events, "add:"+name)
	if f.execErr != nil {
		return 0, f.execErr
	}
	key := f.schema + ".crm_filing_offline"
	for _, col := range f.columns[key] {
		if col.Name == name {
			return 0, fmt.Errorf("duplicate column: %s", name)
		}
	}
	f.columns[key] = append(f.columns[key], connection.ColumnDefinition{Name: name, Type: "varchar(64)", Nullable: "YES"})
	if f.dropOnSchemaAdd && name == "preflight" {
		// Simulate schema drift between planning and metadata refresh: the late
		// column disappears after pre-data DDL, so only snapshot alignment can add it.
		cols := make([]connection.ColumnDefinition, 0, len(f.columns[key]))
		for _, col := range f.columns[key] {
			if col.Name != "late_value" {
				cols = append(cols, col)
			}
		}
		f.columns[key] = cols
	}
	return 0, nil
}

func (f *generatedColumnDB) ExecContext(_ context.Context, query string) (int64, error) {
	return f.Exec(query)
}

func (f *generatedColumnDB) ApplyChanges(table string, changes connection.ChangeSet) error {
	cols := f.columns[f.schema+".crm_filing_offline"]
	check := func(row map[string]interface{}) error {
		for name := range row {
			found := false
			for _, col := range cols {
				if !strings.EqualFold(name, col.Name) {
					continue
				}
				found = true
				if connection.IsGeneratedColumnExtra(col.Extra) {
					f.rejectedWrites++
					return fmt.Errorf("error 3105: cannot write generated column %s", name)
				}
			}
			if !found {
				return fmt.Errorf("unknown write column: %s", name)
			}
		}
		return nil
	}
	for _, row := range changes.Inserts {
		if err := check(row); err != nil {
			return err
		}
	}
	for _, row := range changes.Updates {
		if err := check(row.Values); err != nil {
			return err
		}
	}
	f.events = append(f.events, "apply")
	return f.fakeQuerySyncTargetDB.ApplyChanges(table, changes)
}
