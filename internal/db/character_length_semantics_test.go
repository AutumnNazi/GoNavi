package db

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type characterLengthProbeDatabase struct {
	Database
	query func(string) ([]map[string]interface{}, []string, error)
}

func (d *characterLengthProbeDatabase) Query(query string) ([]map[string]interface{}, []string, error) {
	return d.query(query)
}

func characterLengthProbeRow() map[string]interface{} {
	return map[string]interface{}{
		"gonavi_varchar_char": "中文",
		"gonavi_char_char":    "中文",
		"gonavi_varchar_byte": "ab",
		"gonavi_char_byte":    "ab",
	}
}

func TestProbeCharacterLengthSemanticsByteResults(t *testing.T) {
	database := &characterLengthProbeDatabase{query: func(string) ([]map[string]interface{}, []string, error) {
		row := make(map[string]interface{})
		for column, value := range characterLengthProbeRow() {
			row[strings.ToUpper(column)] = []byte(value.(string))
		}
		return []map[string]interface{}{row}, nil, nil
	}}
	ok, err := ProbeCharacterLengthSemantics(database)
	if err != nil || !ok {
		t.Fatalf("probe byte results = (%v, %v)", ok, err)
	}
}

type characterLengthContextDatabase struct {
	*characterLengthProbeDatabase
	queryContext func(context.Context, string) ([]map[string]interface{}, []string, error)
}

func (d *characterLengthContextDatabase) QueryContext(ctx context.Context, query string) ([]map[string]interface{}, []string, error) {
	return d.queryContext(ctx, query)
}

func TestProbeCharacterLengthSemanticsContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	database := &characterLengthContextDatabase{
		characterLengthProbeDatabase: &characterLengthProbeDatabase{query: func(string) ([]map[string]interface{}, []string, error) {
			t.Fatal("probe ignored cancellation-capable query interface")
			return nil, nil, nil
		}},
		queryContext: func(got context.Context, _ string) ([]map[string]interface{}, []string, error) {
			if got != ctx {
				t.Fatal("probe did not pass bound metadata context")
			}
			cancel()
			return nil, nil, got.Err()
		},
	}
	BindMetadataContext(database, ctx)
	defer ClearMetadataContext(database)
	ok, err := ProbeCharacterLengthSemantics(database)
	if ok || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled probe = (%v, %v)", ok, err)
	}
}

func TestProbeCharacterLengthSemanticsNilDatabase(t *testing.T) {
	var typedNil *characterLengthProbeDatabase
	for _, database := range []Database{nil, typedNil} {
		ok, err := ProbeCharacterLengthSemantics(database)
		if ok || err == nil {
			t.Fatalf("nil database probe = (%v, %v)", ok, err)
		}
	}
}

func TestProbeCharacterLengthSemanticsRejectedResults(t *testing.T) {
	queryErr := errors.New("unsupported length qualifier")
	type testCase struct {
		name string
		rows []map[string]interface{}
		err  error
	}
	tests := []testCase{
		{name: "query error", err: queryErr},
		{name: "no rows"},
		{name: "nil row", rows: []map[string]interface{}{nil}},
		{name: "multiple rows", rows: []map[string]interface{}{characterLengthProbeRow(), characterLengthProbeRow()}},
	}
	for _, column := range []string{"gonavi_varchar_char", "gonavi_char_char", "gonavi_varchar_byte", "gonavi_char_byte"} {
		for _, value := range []interface{}{nil, "中", "", "中文 ", 2} {
			row := characterLengthProbeRow()
			row[column] = value
			tests = append(tests, testCase{name: column, rows: []map[string]interface{}{row}})
		}
		row := characterLengthProbeRow()
		delete(row, column)
		tests = append(tests, testCase{name: "missing " + column, rows: []map[string]interface{}{row}})
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			database := &characterLengthProbeDatabase{query: func(string) ([]map[string]interface{}, []string, error) {
				return test.rows, nil, test.err
			}}
			ok, err := ProbeCharacterLengthSemantics(database)
			if ok || err == nil {
				t.Fatalf("invalid probe = (%v, %v)", ok, err)
			}
			if test.err != nil && !errors.Is(err, test.err) {
				t.Fatalf("probe lost query error: %v", err)
			}
		})
	}
}

func TestProbeCharacterLengthSemanticsSupported(t *testing.T) {
	calls := 0
	database := &characterLengthProbeDatabase{query: func(query string) ([]map[string]interface{}, []string, error) {
		calls++
		upper := strings.ToUpper(query)
		if !strings.HasPrefix(strings.TrimSpace(upper), "SELECT ") || strings.Contains(upper, ";") {
			t.Fatalf("probe must be a single read-only SELECT: %s", query)
		}
		for _, fragment := range []string{
			"CAST('中文' AS VARCHAR(2 CHAR)) AS GONAVI_VARCHAR_CHAR",
			"CAST('中文' AS CHAR(2 CHAR)) AS GONAVI_CHAR_CHAR",
			"CAST('AB' AS VARCHAR(2 BYTE)) AS GONAVI_VARCHAR_BYTE",
			"CAST('AB' AS CHAR(2 BYTE)) AS GONAVI_CHAR_BYTE",
		} {
			if !strings.Contains(upper, fragment) {
				t.Fatalf("probe missing %q: %s", fragment, query)
			}
		}
		return []map[string]interface{}{characterLengthProbeRow()}, nil, nil
	}}
	ok, err := ProbeCharacterLengthSemantics(database)
	if err != nil || !ok || calls != 1 {
		t.Fatalf("probe = (%v, %v), calls = %d", ok, err, calls)
	}
}
