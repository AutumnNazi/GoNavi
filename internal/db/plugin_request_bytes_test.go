package db

import (
	"strings"
	"testing"
)

func TestPluginDatabaseRequestEnvelopeByteBound(t *testing.T) {
	database, runtime := newPluginDatabaseTest(t)
	if _, err := database.invoke(t.Context(), pluginDatabaseRequest{Operation: "query", Query: "SELECT 1"}); err != nil || len(runtime.requests("query")) != 1 {
		t.Fatal(err)
	}
	_, err := database.invoke(t.Context(), pluginDatabaseRequest{Operation: "query", Query: strings.Repeat("文", 400000)})
	if err == nil || !strings.Contains(err.Error(), "request exceeds limits") || len(runtime.requests("query")) != 1 {
		t.Fatal(err)
	}
}
