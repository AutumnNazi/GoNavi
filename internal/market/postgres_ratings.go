package market

import (
	"context"
)

// Ratings lists at most 100 visible ratings, newest first.
func (p *Postgres) Ratings(ctx context.Context, id string) ([]Rating, error) {
	if _, err := p.Plugin(ctx, id); err != nil {
		return nil, err
	}
	rows, err := p.db.QueryContext(ctx, `SELECT user_id,plugin_id,stars,body,version,updated_at FROM market_ratings WHERE plugin_id=$1 AND NOT hidden AND NOT deleted ORDER BY updated_at DESC,user_id LIMIT 100`, id)
	if err != nil {
		return nil, repositoryError(err)
	}
	defer rows.Close()
	result := make([]Rating, 0)
	for rows.Next() {
		var r Rating
		if err = rows.Scan(&r.UserID, &r.PluginID, &r.Stars, &r.Body, &r.Version, &r.UpdatedAt); err != nil {
			return nil, repositoryError(err)
		}
		result = append(result, r)
	}
	return result, repositoryError(rows.Err())
}

// PutRating performs an upsert under the plugin lock and never unhides moderated content.
func (p *Postgres) PutRating(ctx context.Context, a Account, r Rating) (Rating, error) {
	if a.ID == "" {
		return Rating{}, ErrUnauthorized
	}
	if err := validateRating(r); err != nil {
		return Rating{}, err
	}
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return Rating{}, repositoryError(err)
	}
	defer rollback(tx)
	owner, err := requirePublished(ctx, tx, r.PluginID)
	if err != nil {
		return Rating{}, err
	}
	if owner == a.ID {
		return Rating{}, ErrForbidden
	}
	err = tx.QueryRowContext(ctx, `SELECT version FROM market_versions WHERE plugin_id=$1 AND state='published' AND ($2='' OR version=$2) ORDER BY updated_at DESC LIMIT 1`, r.PluginID, r.Version).Scan(&r.Version)
	if err != nil {
		return Rating{}, repositoryError(err)
	}
	r.UserID = a.ID
	err = tx.QueryRowContext(ctx, `INSERT INTO market_ratings(user_id,plugin_id,stars,body,version) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(user_id,plugin_id) DO UPDATE SET stars=EXCLUDED.stars,body=EXCLUDED.body,version=EXCLUDED.version,deleted=false,updated_at=now() RETURNING updated_at`, r.UserID, r.PluginID, r.Stars, r.Body, r.Version).Scan(&r.UpdatedAt)
	if err != nil {
		return Rating{}, repositoryError(err)
	}
	if err = tx.Commit(); err != nil {
		return Rating{}, repositoryError(err)
	}
	return r, nil
}

func validateRating(r Rating) error {
	if r.Stars < 1 || r.Stars > 5 || !boundedText(r.Body, 4000, false) || (r.Version != "" && !validVersion(r.Version)) {
		return ErrInvalid
	}
	return nil
}

// DeleteRating removes the caller's content but preserves moderation in a tombstone.
// A later upsert cannot erase an administrator's hidden flag by deleting first.
func (p *Postgres) DeleteRating(ctx context.Context, a Account, id string) error {
	if a.ID == "" {
		return ErrUnauthorized
	}
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return repositoryError(err)
	}
	defer rollback(tx)
	if _, err = requirePublished(ctx, tx, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE market_ratings SET deleted=true,body='',version='',updated_at=now() WHERE user_id=$1 AND plugin_id=$2", a.ID, id); err != nil {
		return repositoryError(err)
	}
	return repositoryError(tx.Commit())
}

// HideRating changes moderation and its audit record atomically.
func (p *Postgres) HideRating(ctx context.Context, a Account, id, userID, reason string) error {
	if a.Role != "admin" {
		return ErrForbidden
	}
	if !boundedText(reason, 2000, true) {
		return ErrInvalid
	}
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return repositoryError(err)
	}
	defer rollback(tx)
	if _, err = requirePublished(ctx, tx, id); err != nil {
		return err
	}
	if err = affected(tx.ExecContext(ctx, "UPDATE market_ratings SET hidden=true WHERE plugin_id=$1 AND user_id=$2", id, userID)); err != nil {
		return err
	}
	if err = writeAudit(ctx, tx, a.ID, "rating.hide", id+"/"+userID, reason); err != nil {
		return err
	}
	return repositoryError(tx.Commit())
}

// Report stores an authenticated, bounded report against a published plugin.
func (p *Postgres) Report(ctx context.Context, a Account, r Report) error {
	if a.ID == "" {
		return ErrUnauthorized
	}
	if !boundedText(r.Reason, 4000, true) {
		return ErrInvalid
	}
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return repositoryError(err)
	}
	defer rollback(tx)
	if _, err = requirePublished(ctx, tx, r.PluginID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO market_reports(actor_id,plugin_id,reason) VALUES($1,$2,$3)", a.ID, r.PluginID, r.Reason); err != nil {
		return repositoryError(err)
	}
	return repositoryError(tx.Commit())
}
