package db

import (
	"context"
	"encoding/json"
)

func consumePluginDatabaseBudget(ctx context.Context, rows []map[string]interface{}) error {
	budget := RowBudgetFromContext(ctx)
	if budget == nil {
		return nil
	}
	for index, row := range rows {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !budget.CanMaterializeRow(index) {
			return ErrPluginDatabaseBudget
		}
		for _, value := range row {
			if !pluginDatabaseFieldFits(value, budget.MaxFieldBytes()) {
				budget.MarkTruncated()
				return ErrPluginDatabaseBudget
			}
		}
		if !budget.ConsumeRow(estimateQueryRowBytes(row)) {
			return ErrPluginDatabaseBudget
		}
	}
	return nil
}

func pluginDatabaseFieldFits(value any, maximum int) bool {
	if maximum <= 0 {
		return true
	}
	if text, ok := value.(string); ok {
		return len(text) <= maximum
	}
	encoded, err := json.Marshal(value)
	return err == nil && len(encoded) <= maximum
}
