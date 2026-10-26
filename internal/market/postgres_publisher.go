package market

import (
	"context"
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
