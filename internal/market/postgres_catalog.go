package market

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"strconv"

	"github.com/lib/pq"
)

const catalogColumns = `p.id,v.name,v.description,v.author,p.publisher_id,u.official,v.version,
 v.min_host_version,p.source_url,v.platforms,COALESCE(r.average,0),COALESCE(r.count,0),p.download_count,
 v.updated_at,v.manifest,v.sha256,v.size_bytes,market_plugin_category(v.manifest)`

const ratingJoin = ` LEFT JOIN LATERAL (SELECT AVG(stars)::float8 AS average,COUNT(*) AS count
 FROM market_ratings WHERE plugin_id=p.id AND NOT hidden AND NOT deleted) r ON true `

func scanPlugin(row scanner) (MarketPlugin, error) {
	var p MarketPlugin
	var artifact Artifact
	var manifest []byte
	err := row.Scan(&p.ID, &p.Name, &p.Description, &p.Author, &p.PublisherID, &p.Official, &p.Version,
		&p.MinHostVersion, &p.SourceURL, pq.Array(&p.Platforms), &p.RatingAverage, &p.RatingCount, &p.DownloadCount,
		&p.UpdatedAt, &manifest, &artifact.SHA256, &artifact.SizeBytes, &p.Category)
	if err != nil {
		return p, repositoryError(err)
	}
	p.Manifest = manifest
	artifact.Version = p.Version
	artifact.Platform = "any"
	if len(p.Platforms) > 0 {
		artifact.Platform = p.Platforms[0]
	}
	p.Artifact = &artifact
	return p, nil
}

// Catalog selects a compatible published version before paging, always official-first.
func (p *Postgres) Catalog(ctx context.Context, q CatalogQuery) (CatalogPage, error) {
	if err := validateCatalogQuery(q); err != nil {
		return CatalogPage{}, err
	}
	order := "v.updated_at DESC"
	switch q.Sort {
	case "rating":
		order = `((COALESCE(r.average,0)*COALESCE(r.count,0)+10*(SELECT COALESCE(AVG(stars),3) FROM market_ratings rating WHERE NOT hidden AND NOT deleted AND EXISTS(SELECT 1 FROM market_versions published WHERE published.plugin_id=rating.plugin_id AND published.state='published')))/(COALESCE(r.count,0)+10)) DESC`
	case "downloads":
		order = "p.download_count DESC"
	}
	query, arguments := catalogStatement(q, order)
	rows, err := p.db.QueryContext(ctx, query, arguments...)
	if err != nil {
		return CatalogPage{}, repositoryError(err)
	}
	defer rows.Close()
	page := CatalogPage{Items: make([]MarketPlugin, 0, q.Limit)}
	for rows.Next() {
		item, scanErr := scanPlugin(rows)
		if scanErr != nil {
			return CatalogPage{}, scanErr
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return CatalogPage{}, repositoryError(err)
	}
	if len(page.Items) > q.Limit {
		page.Items = page.Items[:q.Limit]
		if q.Offset+q.Limit <= 10000 {
			page.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(q.Offset + q.Limit)))
		}
	}
	return page, nil
}

// Plugin returns only the most recently published version.
func (p *Postgres) Plugin(ctx context.Context, id string) (MarketPlugin, error) {
	query := `SELECT ` + catalogColumns + ` FROM market_plugins p JOIN market_users u ON u.id=p.owner_id
 JOIN market_versions v ON v.plugin_id=p.id` + ratingJoin + ` WHERE p.id=$1 AND v.state='published' ORDER BY v.updated_at DESC,v.id LIMIT 1`
	return scanPlugin(p.db.QueryRowContext(ctx, query, id))
}

// Versions excludes pending, rejected and yanked releases.
func (p *Postgres) Versions(ctx context.Context, id string) ([]MarketPlugin, error) {
	query := `SELECT ` + catalogColumns + ` FROM market_plugins p JOIN market_users u ON u.id=p.owner_id
 JOIN market_versions v ON v.plugin_id=p.id` + ratingJoin + ` WHERE p.id=$1 AND v.state='published' ORDER BY v.updated_at DESC,v.id LIMIT 100`
	rows, err := p.db.QueryContext(ctx, query, id)
	if err != nil {
		return nil, repositoryError(err)
	}
	defer rows.Close()
	result := make([]MarketPlugin, 0)
	for rows.Next() {
		item, scanErr := scanPlugin(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, item)
	}
	if err = rows.Err(); err != nil {
		return nil, repositoryError(err)
	}
	if len(result) == 0 {
		return nil, ErrNotFound
	}
	return result, nil
}

// Artifact resolves one published version and an explicitly supported platform.
func (p *Postgres) Artifact(ctx context.Context, id, version, platform string) (Artifact, error) {
	var a Artifact
	var platforms []string
	err := p.db.QueryRowContext(ctx, `SELECT sha256,size_bytes,version,platforms FROM market_versions WHERE plugin_id=$1 AND version=$2 AND state='published'`, id, version).Scan(&a.SHA256, &a.SizeBytes, &a.Version, pq.Array(&platforms))
	if err != nil {
		return a, repositoryError(err)
	}
	a.Platform = "any"
	if len(platforms) > 0 {
		a.Platform = platforms[0]
	}
	if platform == "" {
		return a, nil
	}
	for _, supported := range platforms {
		if supported == "any" || supported == platform {
			a.Platform = platform
			return a, nil
		}
	}
	return Artifact{}, ErrNotFound
}

// PublishedArtifact gates the byte route, including requests by a known old digest.
func (p *Postgres) PublishedArtifact(ctx context.Context, digest string) (Artifact, error) {
	var a Artifact
	err := p.db.QueryRowContext(ctx, `SELECT sha256,size_bytes,version FROM market_versions WHERE sha256=$1 AND state='published' LIMIT 1`, digest).Scan(&a.SHA256, &a.SizeBytes, &a.Version)
	a.Platform = "any"
	return a, repositoryError(err)
}

// CountDownload records an accepted download, not a claim of completed installation.
func (p *Postgres) CountDownload(ctx context.Context, digest string) error {
	_, err := p.db.ExecContext(ctx, `UPDATE market_plugins SET download_count=download_count+1 WHERE id IN (SELECT plugin_id FROM market_versions WHERE sha256=$1 AND state='published')`, digest)
	return repositoryError(err)
}

func requirePublished(ctx context.Context, tx *sql.Tx, id string) (string, error) {
	var owner string
	err := tx.QueryRowContext(ctx, `SELECT owner_id FROM market_plugins WHERE id=$1 AND EXISTS(SELECT 1 FROM market_versions WHERE plugin_id=$1 AND state='published') FOR UPDATE`, id).Scan(&owner)
	return owner, repositoryError(err)
}

func affected(result sql.Result, err error) error {
	if err != nil {
		return repositoryError(err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("affected rows: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
