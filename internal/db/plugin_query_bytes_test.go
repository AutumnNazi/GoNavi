package db

import (
	"strings"
	"testing"
)

func TestPluginDatabaseQueryByteBound(t *testing.T) {
	db := &PluginDatabase{}
	if _, _, err := db.Query(strings.Repeat("文", 87381)); err == nil || strings.Contains(err.Error(), "exceeds limits") {
		t.Fatal(err)
	}
	if _, _, err := db.Query(strings.Repeat("文", 87382)); err == nil || !strings.Contains(err.Error(), "exceeds limits") {
		t.Fatal(err)
	}
}
