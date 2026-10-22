package db

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestPluginDatabaseCellByteBound(t *testing.T) {
	for _, test := range []struct {
		name  string
		count int
		ok    bool
	}{
		{name: "exact", count: 87381, ok: true},
		{name: "over", count: 87382},
	} {
		t.Run(test.name, func(t *testing.T) {
			value := strings.Repeat("文", test.count)
			payload, err := json.Marshal(map[string]any{"fields": []string{"id"}, "rows": []map[string]string{{"id": value}}})
			if err != nil {
				t.Fatal(err)
			}
			rows, fields, err := decodePluginQuery(json.RawMessage(payload))
			if test.ok && (err != nil || len(fields) != 1 || len(rows) != 1 || rows[0]["id"] != value) {
				t.Fatal(err)
			}
			if !test.ok && (!errors.Is(err, ErrPluginDatabaseProtocol) || rows != nil || fields != nil) {
				t.Fatal(err)
			}
		})
	}
}
