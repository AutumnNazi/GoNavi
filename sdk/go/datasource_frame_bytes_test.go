package plugin

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestDataSourceFrameRejectsCombinedLegalCells(t *testing.T) {
	text := strings.Repeat("文", 80000)
	if len(text) > 256<<10 {
		t.Fatal("cell fixture exceeds the host cell limit")
	}
	result := func(rows int) DataSourceQueryResult {
		out := DataSourceQueryResult{Fields: []string{"id"}, Rows: make([]map[string]any, rows)}
		for i := range out.Rows {
			out.Rows[i] = map[string]any{"id": text}
		}
		return out
	}
	check := func(rows int) error {
		operations := driverFixture()
		operations.Query = func(context.Context, DataSourceRequest) (DataSourceQueryResult, error) { return result(rows), nil }
		dispatcher := NewDataSourceDispatcher(operations)
		if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "s")); err != nil {
			return err
		}
		_, err := dispatcher.Handle(context.Background(), driverRequest("query", "s"))
		return err
	}
	if err := check(4); err != nil {
		t.Fatal(err)
	}
	if err := check(5); !errors.Is(err, ErrDataSourceLimit) {
		t.Fatal(err)
	}
}
