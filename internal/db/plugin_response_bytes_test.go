package db

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestPluginDatabaseResponseEnvelopeByteBound(t *testing.T) {
	database, runtime := newPluginDatabaseTest(t)
	if _, err := database.invoke(t.Context(), pluginDatabaseRequest{Operation: "query", Query: "SELECT 1"}); err != nil {
		t.Fatal(err)
	}
	runtime.handler = func(context.Context, pluginDatabaseRequest) (json.RawMessage, error) {
		return json.RawMessage(strings.Repeat("文", 400000)), nil
	}
	if _, err := database.invoke(t.Context(), pluginDatabaseRequest{Operation: "query", Query: "SELECT 1"}); !errors.Is(err, ErrPluginDatabaseProtocol) {
		t.Fatal(err)
	}
}
