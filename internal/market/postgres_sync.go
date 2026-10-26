package market

import (
	"context"
)

// SourcePlugin pairs one tracked plugin with the owner account its automated
// submissions run as and the newest already-published version, if any.
type SourcePlugin struct {
	PluginID         string
	SourceURL        string
	Owner            Account
	PublishedVersion string
}

// SourcePlugins lists every plugin registered for GitHub release auto-sync.
func (p *Postgres) SourcePlugins(ctx context.Context) ([]SourcePlugin, error) {
	rows, err := p.db.QueryContext(ctx, `SELECT p.id,p.source_url,u.id,u.login,u.role,u.publisher_id,u.official,
		COALESCE((SELECT version FROM market_versions WHERE plugin_id=p.id AND state='published' ORDER BY updated_at DESC,id LIMIT 1),'')
		FROM market_plugins p JOIN market_users u ON u.id=p.owner_id WHERE p.source_url<>'' ORDER BY p.id`)
	if err != nil {
		return nil, repositoryError(err)
	}
	defer rows.Close()
	result := []SourcePlugin{}
	for rows.Next() {
		var item SourcePlugin
		if err = rows.Scan(&item.PluginID, &item.SourceURL, &item.Owner.ID, &item.Owner.Login, &item.Owner.Role,
			&item.Owner.PublisherID, &item.Owner.Official, &item.PublishedVersion); err != nil {
			return nil, repositoryError(err)
		}
		result = append(result, item)
	}
	return result, repositoryError(rows.Err())
}

// SetPluginSource registers or replaces the GitHub repository a plugin tracks.
// Only the owning publisher may change it, matching manual submission rights.
func (p *Postgres) SetPluginSource(ctx context.Context, owner Account, pluginID, sourceURL string) error {
	if _, _, err := parseRepositoryURL(sourceURL); err != nil {
		return err
	}
	return p.storePluginSource(ctx, owner, pluginID, sourceURL)
}

// ClearPluginSource turns auto-sync off by emptying the tracked repository.
// Deletion is a distinct operation so SetPluginSource never accepts empty input.
func (p *Postgres) ClearPluginSource(ctx context.Context, owner Account, pluginID string) error {
	return p.storePluginSource(ctx, owner, pluginID, "")
}

func (p *Postgres) storePluginSource(ctx context.Context, owner Account, pluginID, sourceURL string) error {
	if !validPluginID(pluginID) {
		return ErrInvalid
	}
	result, err := p.db.ExecContext(ctx, "UPDATE market_plugins SET source_url=$3 WHERE id=$1 AND owner_id=$2", pluginID, owner.ID, sourceURL)
	if err != nil {
		return repositoryError(err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return repositoryError(err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}
