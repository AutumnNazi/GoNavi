package plugin

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestDataSourceRequestByteBounds(t *testing.T) {
	if _, err := decodeDataSourceRequest(json.RawMessage(`{"protocolVersion":1,"operation":"query","sessionId":"s","query":"SELECT 1"}`)); err != nil {
		t.Fatal(err)
	}
	padded := json.RawMessage(`{"protocolVersion":1,"operation":"query","sessionId":"s","query":"SELECT 1","padding":"` + strings.Repeat("文", 400000) + `"}`)
	if _, err := decodeDataSourceRequest(padded); !errors.Is(err, ErrDataSourceLimit) {
		t.Fatal(err)
	}
	raw := json.RawMessage(`{"protocolVersion":1,"operation":"query","sessionId":"s","query":"` + strings.Repeat("文", 90000) + `"}`)
	if _, err := decodeDataSourceRequest(raw); !errors.Is(err, ErrDataSourceLimit) {
		t.Fatal(err)
	}
	name := strings.Repeat("中", 342)
	_, err := normalizeDataSourceQuery(DataSourceQueryResult{Fields: []string{name}, Rows: []map[string]any{{name: "x"}}}, nil)
	if !errors.Is(err, ErrDataSourceResult) {
		t.Fatal(err)
	}
}
