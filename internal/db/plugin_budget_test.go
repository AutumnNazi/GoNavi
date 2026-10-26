package db

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestPluginDatabaseHonorsCallerRowAndByteBudgets(t *testing.T) {
	cases := map[string]RowBudgetOptions{
		"rows": {MaxRowsPerResult: 1}, "totalRows": {MaxTotalRows: 1}, "bytes": {MaxTotalBytes: 1}, "field": {MaxFieldBytes: 2},
	}
	for name, options := range cases {
		t.Run(name, func(t *testing.T) {
			database, runtime := connectedPluginDatabaseTest(t)
			runtime.handler = func(_ context.Context, request pluginDatabaseRequest) (json.RawMessage, error) {
				if request.Operation == "query" {
					return json.RawMessage(`{"rows":[{"value":"first"},{"value":"second"}],"fields":["value"]}`), nil
				}
				return pluginDatabaseTestReply(request.Operation), nil
			}
			budget := NewRowBudgetWithOptions(options)
			rows, fields, err := database.QueryContext(ContextWithRowBudget(t.Context(), budget), "SELECT 1")
			if !errors.Is(err, ErrPluginDatabaseBudget) || rows != nil || fields != nil {
				t.Fatal("over-budget reply returned partial success")
			}
			if !budget.Exhausted() {
				t.Fatal("over-budget state not recorded")
			}
			if !database.IsCurrent() {
				t.Fatal("caller budget rejection unnecessarily closed session")
			}
		})
	}
}

func TestPluginDatabaseConsumesSharedBudgetForSuccessfulReplies(t *testing.T) {
	database, _ := connectedPluginDatabaseTest(t)
	budget := NewRowBudgetWithOptions(RowBudgetOptions{MaxTotalRows: 1, MaxTotalBytes: 1024, MaxFieldBytes: 64})
	ctx := ContextWithRowBudget(t.Context(), budget)
	if rows, _, err := database.QueryContext(ctx, "SELECT 1"); err != nil || len(rows) != 1 {
		t.Fatal(err)
	}
	if budget.RemainingOptions().MaxTotalRows != 0 {
		t.Fatal("row budget was not consumed")
	}
	if _, _, err := database.QueryContext(ctx, "SELECT 1"); !errors.Is(err, ErrPluginDatabaseBudget) {
		t.Fatal("shared remaining budget ignored")
	}
}
