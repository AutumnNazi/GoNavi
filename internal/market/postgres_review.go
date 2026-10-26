package market

import (
	"context"
	"database/sql"
	"strings"

	"github.com/lib/pq"
)

const submissionColumns = "v.id,v.plugin_id,v.version,v.state,p.publisher_id,v.reason,v.sha256,v.created_at,v.updated_at"

func scanSubmission(row scanner) (Submission, error) {
	var s Submission
	err := row.Scan(&s.ID, &s.PluginID, &s.Version, &s.State, &s.PublisherID, &s.Reason, &s.SHA256, &s.CreatedAt, &s.UpdatedAt)
	return s, repositoryError(err)
}

func lockedSubmission(ctx context.Context, tx *sql.Tx, id string) (Submission, string, error) {
	s, err := scanSubmission(tx.QueryRowContext(ctx, "SELECT "+submissionColumns+" FROM market_versions v JOIN market_plugins p ON p.id=v.plugin_id WHERE v.id=$1 FOR UPDATE OF v,p", id))
	if err != nil {
		return s, "", err
	}
	var owner string
	err = tx.QueryRowContext(ctx, "SELECT owner_id FROM market_plugins WHERE id=$1", s.PluginID).Scan(&owner)
	return s, owner, repositoryError(err)
}

// BeginSubmission reserves plugin ownership and a version before any validation work.
func (p *Postgres) BeginSubmission(ctx context.Context, a Account, id, version string) (Submission, error) {
	if (a.Role != "publisher" && a.Role != "admin") || a.PublisherID == "" {
		return Submission{}, ErrForbidden
	}
	if !validPluginID(id) || !validVersion(version) {
		return Submission{}, ErrInvalid
	}
	if !strings.HasPrefix(id, a.PublisherID+".") {
		return Submission{}, ErrForbidden
	}
	secret, err := newSecret(24)
	if err != nil {
		return Submission{}, err
	}
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return Submission{}, repositoryError(err)
	}
	defer rollback(tx)
	current, err := scanAccount(tx.QueryRowContext(ctx, "SELECT "+accountColumns+" FROM market_users WHERE id=$1 FOR SHARE", a.ID))
	if err != nil {
		return Submission{}, err
	}
	if (current.Role != "publisher" && current.Role != "admin") || current.PublisherID != a.PublisherID {
		return Submission{}, ErrForbidden
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO market_plugins(id,owner_id,publisher_id) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING", id, a.ID, a.PublisherID)
	if err != nil {
		return Submission{}, repositoryError(err)
	}
	var owner string
	if err = tx.QueryRowContext(ctx, "SELECT owner_id FROM market_plugins WHERE id=$1 FOR UPDATE", id).Scan(&owner); err != nil {
		return Submission{}, repositoryError(err)
	}
	if owner != a.ID {
		return Submission{}, ErrForbidden
	}
	submissionID := "s_" + secret
	_, err = tx.ExecContext(ctx, "INSERT INTO market_versions(id,plugin_id,version,state) VALUES($1,$2,$3,'draft')", submissionID, id, version)
	if err != nil {
		return Submission{}, repositoryError(err)
	}
	if err = writeAudit(ctx, tx, a.ID, "submission.draft", submissionID, ""); err != nil {
		return Submission{}, err
	}
	s, _, err := lockedSubmission(ctx, tx, submissionID)
	if err != nil {
		return Submission{}, err
	}
	if err = tx.Commit(); err != nil {
		return Submission{}, repositoryError(err)
	}
	return s, nil
}

// AdvanceSubmission records pre-review pipeline transitions and terminal validation failure.
func (p *Postgres) AdvanceSubmission(ctx context.Context, a Account, id, state, reason string) (Submission, error) {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return Submission{}, repositoryError(err)
	}
	defer rollback(tx)
	s, owner, err := lockedSubmission(ctx, tx, id)
	if err != nil {
		return s, err
	}
	if owner != a.ID {
		return s, ErrForbidden
	}
	allowed := (s.State == "draft" && state == "submitted") || (s.State == "submitted" && state == "validating") || (s.State == "validating" && state == "rejected")
	if !allowed {
		return s, ErrConflict
	}
	if !boundedText(reason, 2000, false) {
		return s, ErrInvalid
	}
	s, err = transition(ctx, tx, a.ID, s, state, reason)
	if err != nil {
		return s, err
	}
	if err = tx.Commit(); err != nil {
		return s, repositoryError(err)
	}
	return s, nil
}

func transition(ctx context.Context, tx *sql.Tx, actor string, s Submission, state, reason string) (Submission, error) {
	err := tx.QueryRowContext(ctx, "UPDATE market_versions SET state=$2,reason=$3,updated_at=now() WHERE id=$1 RETURNING updated_at", s.ID, state, reason).Scan(&s.UpdatedAt)
	if err != nil {
		return s, repositoryError(err)
	}
	if err = writeAudit(ctx, tx, actor, "submission."+state, s.ID, reason); err != nil {
		return s, err
	}
	s.State = state
	s.Reason = reason
	return s, nil
}

// ValidateSubmission attaches bytes and manifest only to the publisher's validating version.
func (p *Postgres) ValidateSubmission(ctx context.Context, a Account, id string, v ValidatedPackage) (Submission, error) {
	if !digestPattern.MatchString(v.SHA256) || v.SizeBytes <= 0 || v.SizeBytes > MaxArtifactBytes || len(v.Manifest) == 0 {
		return Submission{}, ErrInvalid
	}
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return Submission{}, repositoryError(err)
	}
	defer rollback(tx)
	s, owner, err := lockedSubmission(ctx, tx, id)
	if err != nil {
		return s, err
	}
	if owner != a.ID {
		return s, ErrForbidden
	}
	if s.State != "validating" {
		return s, ErrConflict
	}
	if s.PluginID != v.ID || s.Version != v.Version {
		return s, ErrInvalid
	}
	_, err = tx.ExecContext(ctx, `UPDATE market_versions SET name=$2,description=$3,author=$4,min_host_version=$5,platforms=$6,manifest=$7,sha256=$8,size_bytes=$9 WHERE id=$1`,
		id, v.Name, v.Description, v.Author, v.MinHostVersion, pq.Array(v.Platforms), string(v.Manifest), v.SHA256, v.SizeBytes)
	if err != nil {
		return s, repositoryError(err)
	}
	s.SHA256 = v.SHA256
	s, err = transition(ctx, tx, a.ID, s, "pending_review", "")
	if err != nil {
		return s, err
	}
	if err = tx.Commit(); err != nil {
		return s, repositoryError(err)
	}
	return s, nil
}

// SelfPublish atomically publishes one owned pending version after static
// validation. Official certification stays operator-owned and takedowns still
// go through Review, so this path only removes the queue wait, not oversight.
func (p *Postgres) SelfPublish(ctx context.Context, a Account, id string) (Submission, error) {
	if a.Role != "publisher" && a.Role != "admin" {
		return Submission{}, ErrForbidden
	}
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return Submission{}, repositoryError(err)
	}
	defer rollback(tx)
	s, owner, err := lockedSubmission(ctx, tx, id)
	if err != nil {
		return s, err
	}
	if owner != a.ID {
		return s, ErrForbidden
	}
	if s.State != "pending_review" || s.SHA256 == "" {
		return s, ErrConflict
	}
	s, err = transition(ctx, tx, a.ID, s, "published", "self-service publication")
	if err != nil {
		return s, err
	}
	if err = tx.Commit(); err != nil {
		return s, repositoryError(err)
	}
	return s, nil
}

// Submissions lists the caller's versions, or the bounded admin review queue.
func (p *Postgres) Submissions(ctx context.Context, a Account) ([]Submission, error) {
	if a.Role != "admin" && a.Role != "publisher" {
		return nil, ErrForbidden
	}
	rows, err := p.db.QueryContext(ctx, "SELECT "+submissionColumns+" FROM market_versions v JOIN market_plugins p ON p.id=v.plugin_id WHERE ($1 OR p.owner_id=$2) ORDER BY v.updated_at DESC,v.id LIMIT 200", a.Role == "admin", a.ID)
	if err != nil {
		return nil, repositoryError(err)
	}
	defer rows.Close()
	result := make([]Submission, 0)
	for rows.Next() {
		s, scanErr := scanSubmission(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, s)
	}
	return result, repositoryError(rows.Err())
}

// Review atomically publishes, rejects or yanks one version and appends audit history.
func (p *Postgres) Review(ctx context.Context, a Account, id, action, reason string) (Submission, error) {
	if a.Role != "admin" {
		return Submission{}, ErrForbidden
	}
	if !boundedText(reason, 2000, action != "approve") {
		return Submission{}, ErrInvalid
	}
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return Submission{}, repositoryError(err)
	}
	defer rollback(tx)
	s, owner, err := lockedSubmission(ctx, tx, id)
	if err != nil {
		return s, err
	}
	state := ""
	switch {
	case action == "approve" && s.State == "pending_review" && s.SHA256 != "":
		if owner == a.ID {
			return s, ErrForbidden
		}
		state = "published"
	case action == "reject" && s.State == "pending_review":
		state = "rejected"
	case action == "yank" && s.State == "published":
		state = "yanked"
	default:
		return s, ErrConflict
	}
	s, err = transition(ctx, tx, a.ID, s, state, reason)
	if err != nil {
		return s, err
	}
	if err = tx.Commit(); err != nil {
		return s, repositoryError(err)
	}
	return s, nil
}

// Audits returns newest privileged actions to administrators only.
func (p *Postgres) Audits(ctx context.Context, a Account) ([]Audit, error) {
	if a.Role != "admin" {
		return nil, ErrForbidden
	}
	rows, err := p.db.QueryContext(ctx, "SELECT id,actor_id,action,subject,reason,created_at FROM market_audit ORDER BY id DESC LIMIT 200")
	if err != nil {
		return nil, repositoryError(err)
	}
	defer rows.Close()
	result := make([]Audit, 0)
	for rows.Next() {
		var event Audit
		if err = rows.Scan(&event.ID, &event.ActorID, &event.Action, &event.Subject, &event.Reason, &event.CreatedAt); err != nil {
			return nil, repositoryError(err)
		}
		result = append(result, event)
	}
	return result, repositoryError(rows.Err())
}
