package market

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"time"
)

const accountColumns = "id,login,role,publisher_id,official"

var githubIDPattern = regexp.MustCompile(`^[1-9][0-9]{0,19}$`)
var publisherPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,62}$`)

// UpsertIdentity never assigns privileges; only a deployment operator may grant them.
func (p *Postgres) UpsertIdentity(ctx context.Context, identity Identity) (Account, error) {
	if identity.ID == "" || identity.Login == "" {
		return Account{}, ErrInvalid
	}
	query := `INSERT INTO market_users(id,login) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET login=EXCLUDED.login RETURNING ` + accountColumns
	return scanAccount(p.db.QueryRowContext(ctx, query, identity.ID, identity.Login))
}

// GrantRole is an explicit operator bootstrap operation, not a public signup path.
func (p *Postgres) GrantRole(ctx context.Context, githubID, publisher, role string, official bool) error {
	if !githubIDPattern.MatchString(githubID) || (publisher != "" && !publisherPattern.MatchString(publisher)) {
		return ErrInvalid
	}
	if role != "user" && role != "publisher" && role != "admin" {
		return ErrInvalid
	}
	if (role == "publisher" || official) && publisher == "" {
		return ErrInvalid
	}
	if role == "user" && official {
		return ErrInvalid
	}
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return repositoryError(err)
	}
	defer rollback(tx)
	if _, err = tx.ExecContext(ctx, "INSERT INTO market_users(id) VALUES($1) ON CONFLICT(id) DO NOTHING", githubID); err != nil {
		return repositoryError(err)
	}
	var lockedID string
	if err = tx.QueryRowContext(ctx, "SELECT id FROM market_users WHERE id=$1 FOR UPDATE", githubID).Scan(&lockedID); err != nil {
		return repositoryError(err)
	}
	// A separate statement after the account lock observes any completed publisher reservation.
	var ownsOtherNamespace bool
	if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM market_plugins WHERE owner_id=$1 AND publisher_id<>$2)", githubID, publisher).Scan(&ownsOtherNamespace); err != nil {
		return repositoryError(err)
	}
	if ownsOtherNamespace {
		return ErrConflict
	}
	if _, err = tx.ExecContext(ctx, "UPDATE market_users SET role=$2,publisher_id=$3,official=$4 WHERE id=$1", githubID, role, publisher, official); err != nil {
		return repositoryError(err)
	}
	if err = writeAudit(ctx, tx, "bootstrap:operator", "account.role", githubID, fmt.Sprintf("role=%s publisher=%s official=%t", role, publisher, official)); err != nil {
		return err
	}
	return repositoryError(tx.Commit())
}

// Session resolves current privileges on every request, including role revocation.
func (p *Postgres) Session(ctx context.Context, hash string, now time.Time) (Account, error) {
	a, err := scanAccount(p.db.QueryRowContext(ctx, `SELECT u.id,u.login,u.role,u.publisher_id,u.official FROM market_sessions s JOIN market_users u ON u.id=s.account_id WHERE token_hash=$1 AND expires_at>$2`, hash, now))
	if errors.Is(err, ErrNotFound) {
		return a, ErrUnauthorized
	}
	return a, err
}

// RevokeSession immediately invalidates a bearer token in every replica.
func (p *Postgres) RevokeSession(ctx context.Context, hash string) error {
	_, err := p.db.ExecContext(ctx, "DELETE FROM market_sessions WHERE token_hash=$1", hash)
	return repositoryError(err)
}

// CreateDevice persists hashes only; expired grants are pruned in bounded batches.
func (p *Postgres) CreateDevice(ctx context.Context, d DeviceGrant) error {
	if _, err := p.db.ExecContext(ctx, "DELETE FROM market_sessions WHERE token_hash IN (SELECT token_hash FROM market_sessions WHERE expires_at<now() LIMIT 1000)"); err != nil {
		return repositoryError(err)
	}
	_, err := p.db.ExecContext(ctx, "DELETE FROM market_devices WHERE code_hash IN (SELECT code_hash FROM market_devices WHERE expires_at<now() LIMIT 1000)")
	if err != nil {
		return repositoryError(err)
	}
	_, err = p.db.ExecContext(ctx, "INSERT INTO market_devices(code_hash,user_code_hash,state,expires_at,next_poll_at) VALUES($1,$2,'pending',$3,$4)", d.CodeHash, d.UserCodeHash, d.ExpiresAt, d.NextPollAt)
	return repositoryError(err)
}

// PollDevice atomically consumes authorization and issues exactly one revocable session.
func (p *Postgres) PollDevice(ctx context.Context, hash, sessionHash string, now, sessionExpires time.Time) (string, error) {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return "", repositoryError(err)
	}
	defer rollback(tx)
	var d DeviceGrant
	err = tx.QueryRowContext(ctx, "SELECT state,COALESCE(account_id,''),expires_at,next_poll_at FROM market_devices WHERE code_hash=$1 FOR UPDATE", hash).Scan(&d.State, &d.AccountID, &d.ExpiresAt, &d.NextPollAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "expired", nil
	}
	if err != nil {
		return "", repositoryError(err)
	}
	if !d.ExpiresAt.After(now) || d.State == "consumed" {
		return "expired", nil
	}
	if d.NextPollAt.After(now) {
		return "slow_down", nil
	}
	if _, err = tx.ExecContext(ctx, "UPDATE market_devices SET next_poll_at=$2 WHERE code_hash=$1", hash, now.Add(5*time.Second)); err != nil {
		return "", repositoryError(err)
	}
	if d.State == "authorized" {
		if d.AccountID == "" {
			return "", ErrUnauthorized
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO market_sessions(token_hash,account_id,expires_at) VALUES($1,$2,$3)", sessionHash, d.AccountID, sessionExpires); err != nil {
			return "", repositoryError(err)
		}
		if _, err = tx.ExecContext(ctx, "UPDATE market_devices SET state='consumed' WHERE code_hash=$1", hash); err != nil {
			return "", repositoryError(err)
		}
	}
	if err = tx.Commit(); err != nil {
		return "", repositoryError(err)
	}
	return d.State, nil
}

// DecideDevice accepts one explicit, authenticated browser decision before expiry.
func (p *Postgres) DecideDevice(ctx context.Context, userHash, accountID string, approve bool, now time.Time) error {
	state := "denied"
	if approve {
		state = "authorized"
	}
	return affected(p.db.ExecContext(ctx, "UPDATE market_devices SET state=$2,account_id=NULLIF($3,'') WHERE user_code_hash=$1 AND state='pending' AND expires_at>$4", userHash, state, accountID, now))
}

// CreateFlow stores short-lived PKCE and consent state for replica-safe callbacks.
func (p *Postgres) CreateFlow(ctx context.Context, f AuthFlow) error {
	_, err := p.db.ExecContext(ctx, "DELETE FROM market_auth_flows WHERE hash IN (SELECT hash FROM market_auth_flows WHERE expires_at<now() LIMIT 1000)")
	if err != nil {
		return repositoryError(err)
	}
	_, err = p.db.ExecContext(ctx, "INSERT INTO market_auth_flows(hash,kind,verifier,user_code,account_id,expires_at) VALUES($1,$2,$3,$4,$5,$6)", f.Hash, f.Kind, f.Verifier, f.UserCode, f.AccountID, f.ExpiresAt)
	return repositoryError(err)
}

// ConsumeFlow prevents replay, including concurrent callbacks on separate replicas.
func (p *Postgres) ConsumeFlow(ctx context.Context, hash, kind string, now time.Time) (AuthFlow, error) {
	var f AuthFlow
	err := p.db.QueryRowContext(ctx, `DELETE FROM market_auth_flows WHERE hash=$1 AND kind=$2 AND expires_at>$3 RETURNING hash,kind,verifier,user_code,account_id,expires_at`, hash, kind, now).Scan(&f.Hash, &f.Kind, &f.Verifier, &f.UserCode, &f.AccountID, &f.ExpiresAt)
	return f, repositoryError(err)
}
