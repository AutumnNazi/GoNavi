package sessionassets

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// RecordHandoff 持久化一次交接准备记录（用户主动动作的审计线索）。
func (c *Catalog) RecordHandoff(ctx context.Context, assetID, kind string, payload map[string]any) error {
	id, err := newID()
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode handoff payload: %w", err)
	}
	_, err = c.db.ExecContext(ctx,
		`INSERT INTO handoff_records (id, asset_id, kind, payload_json, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		id, assetID, kind, string(encoded), time.Now().Unix())
	if err != nil {
		return fmt.Errorf("record handoff: %w", err)
	}
	return nil
}
