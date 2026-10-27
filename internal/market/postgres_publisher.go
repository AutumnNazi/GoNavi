package market

import (
	"context"
	"database/sql"
	"errors"
)

// publisherPluginQuery lists one owner page. The lateral joins select the newest
// version overall and the newest published version independently, so a yanked or
// rejected newest version never hides the public one. A draft carries no display
// name, so the newest published name is the fallback.
const publisherPluginQuery = `SELECT p.id,
 COALESCE(NULLIF(newest.name,''),released.name,''),COALESCE(newest.version,''),COALESCE(newest.state,''),
 COALESCE(released.version,''),p.source_url
 FROM market_plugins p
 LEFT JOIN LATERAL (SELECT name,version,state FROM market_versions v WHERE v.plugin_id=p.id ORDER BY v.updated_at DESC,v.id DESC LIMIT 1) newest ON true
 LEFT JOIN LATERAL (SELECT name,version FROM market_versions v WHERE v.plugin_id=p.id AND v.state='published' ORDER BY v.updated_at DESC,v.id DESC LIMIT 1) released ON true
 WHERE p.owner_id=$1 AND ($2='' OR p.id=$2)
 ORDER BY p.id LIMIT $3 OFFSET $4`

// PublisherPlugins returns plugins owned by the caller, including drafts.
func (p *Postgres) PublisherPlugins(ctx context.Context, a Account, q PublisherQuery) (PublisherPluginPage, error) {
	page := PublisherPluginPage{Items: []PublisherPlugin{}}
	if a.ID == "" || q.Limit < 1 || q.Offset < 0 {
		return page, ErrInvalid
	}
	rows, err := p.db.QueryContext(ctx, publisherPluginQuery, a.ID, q.PluginID, q.Limit+1, q.Offset)
	if err != nil {
		return page, repositoryError(err)
	}
	defer rows.Close()
	for rows.Next() {
		var item PublisherPlugin
		if err = rows.Scan(&item.ID, &item.Name, &item.LatestVersion, &item.LatestState, &item.PublishedVersion, &item.SourceURL); err != nil {
			return page, repositoryError(err)
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return page, repositoryError(err)
	}
	page.NextCursor = publishCursor(q.Offset, q.Limit, len(page.Items))
	if len(page.Items) > q.Limit {
		page.Items = page.Items[:q.Limit]
	}
	return page, nil
}

// PublisherSubmissions returns the caller's own submission history, newest first.
func (p *Postgres) PublisherSubmissions(ctx context.Context, a Account, q PublisherQuery) (PublisherSubmissionPage, error) {
	page := PublisherSubmissionPage{Items: []Submission{}}
	if a.ID == "" || q.Limit < 1 || q.Offset < 0 {
		return page, ErrInvalid
	}
	rows, err := p.db.QueryContext(ctx, "SELECT "+submissionColumns+` FROM market_versions v JOIN market_plugins p ON p.id=v.plugin_id
		WHERE p.owner_id=$1 AND ($2='' OR v.plugin_id=$2)
		ORDER BY v.updated_at DESC,v.id DESC LIMIT $3 OFFSET $4`, a.ID, q.PluginID, q.Limit+1, q.Offset)
	if err != nil {
		return page, repositoryError(err)
	}
	defer rows.Close()
	for rows.Next() {
		s, scanErr := scanSubmission(rows)
		if scanErr != nil {
			return page, scanErr
		}
		page.Items = append(page.Items, s)
	}
	if err = rows.Err(); err != nil {
		return page, repositoryError(err)
	}
	page.NextCursor = publishCursor(q.Offset, q.Limit, len(page.Items))
	if len(page.Items) > q.Limit {
		page.Items = page.Items[:q.Limit]
	}
	return page, nil
}

// DeletePlugin removes one plugin and every row that references it in a single
// transaction. The purge setting is SET LOCAL, so the release-immutability
// trigger only permits this transaction's version deletes; every other DELETE
// and every UPDATE keeps the original protection. Artifact bytes are immutable
// and stay in the store (no garbage collector).
func (p *Postgres) DeletePlugin(ctx context.Context, a Account, pluginID string) error {
	if a.ID == "" {
		return ErrUnauthorized
	}
	if !validPluginID(pluginID) {
		return ErrInvalid
	}
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return repositoryError(err)
	}
	defer rollback(tx)
	var owner string
	err = tx.QueryRowContext(ctx, "SELECT owner_id FROM market_plugins WHERE id=$1 FOR UPDATE", pluginID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return repositoryError(err)
	}
	if owner != a.ID && a.Role != "admin" {
		return ErrForbidden
	}
	if _, err = tx.ExecContext(ctx, "SET LOCAL gonavi.market.purge='on'"); err != nil {
		return repositoryError(err)
	}
	// Reports, ratings and versions all reference market_plugins without a
	// cascade, so each child table is emptied explicitly before the plugin row.
	for _, statement := range []string{
		"DELETE FROM market_reports WHERE plugin_id=$1",
		"DELETE FROM market_ratings WHERE plugin_id=$1",
		"DELETE FROM market_versions WHERE plugin_id=$1",
	} {
		if _, err = tx.ExecContext(ctx, statement, pluginID); err != nil {
			return repositoryError(err)
		}
	}
	result, err := tx.ExecContext(ctx, "DELETE FROM market_plugins WHERE id=$1", pluginID)
	if err != nil {
		return repositoryError(err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return repositoryError(err)
	}
	if affected != 1 {
		return ErrConflict
	}
	// Verify the purge left no orphan child rows before recording the audit.
	var orphaned bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM market_versions WHERE plugin_id=$1)
		OR EXISTS(SELECT 1 FROM market_ratings WHERE plugin_id=$1)
		OR EXISTS(SELECT 1 FROM market_reports WHERE plugin_id=$1)`, pluginID).Scan(&orphaned); err != nil {
		return repositoryError(err)
	}
	if orphaned {
		return ErrConflict
	}
	if err = writeAudit(ctx, tx, a.ID, "plugin.delete", pluginID, "owner delete"); err != nil {
		return err
	}
	return repositoryError(tx.Commit())
}
