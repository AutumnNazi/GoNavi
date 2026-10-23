package db

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestPluginDatabaseFieldNameByteBound(t *testing.T) {
	for _, test := range []struct {
		name  string
		count int
		ok    bool
	}{
		{name: "exact", count: 341, ok: true},
		{name: "over", count: 342},
	} {
		t.Run(test.name, func(t *testing.T) {
			field := strings.Repeat("中", test.count)
			payload, err := json.Marshal(map[string]any{"fields": []string{field}, "rows": []map[string]string{{field: "ok"}}})
			if err != nil {
				t.Fatal(err)
			}
			rows, fields, err := decodePluginQuery(json.RawMessage(payload))
			if test.ok && (err != nil || len(fields) != 1 || fields[0] != field || len(rows) != 1) {
				t.Fatal(err)
			}
			if !test.ok && (!errors.Is(err, ErrPluginDatabaseProtocol) || rows != nil || fields != nil) {
				t.Fatal(err)
			}
		})
	}
}
