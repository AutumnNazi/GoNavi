package market

import (
	"fmt"
	"testing"
)

func TestArtifactPanelTableCountBounds(t *testing.T) {
	columns := make([]any, 32)
	for i := range columns {
		columns[i] = map[string]any{"key": fmt.Sprintf("c%d", i), "title": "C"}
	}
	rows := make([]any, 500)
	for i := range rows {
		rows[i] = map[string]any{}
	}
	check := func(t *testing.T, body map[string]any, ok bool) {
		t.Helper()
		decoded, err := decodeArtifactManifest([]byte(artifactTestChange(t, func(fields map[string]any) {
			fields["contributes"] = map[string]any{"panels": []any{map[string]any{"id": "main", "title": "Panel", "body": body}}}
		})))
		if err != nil {
			t.Fatal(err)
		}
		err = validateArtifactContributions(decoded)
		if ok && err != nil {
			t.Fatal(err)
		}
		if !ok && err == nil {
			t.Fatal("oversized panel table was accepted")
		}
	}
	check(t, map[string]any{"type": "table", "columns": columns, "rows": rows}, true)
	check(t, map[string]any{"type": "table", "columns": append(columns, map[string]any{"key": "extra", "title": "C"}), "rows": rows}, false)
	check(t, map[string]any{"type": "table", "columns": columns, "rows": append(rows, map[string]any{})}, false)
	children := make([]any, 129)
	for i := range children {
		children[i] = map[string]any{"type": "text", "text": "x"}
	}
	check(t, map[string]any{"type": "column", "children": children[:128]}, true)
	check(t, map[string]any{"type": "column", "children": children}, false)
}
