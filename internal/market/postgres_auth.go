package market

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const accountColumns = "id,login,role,publisher_id,official"

var githubIDPattern = regexp.MustCompile(`^[1-9][0-9]{0,19}$`)

// publisherPattern allows dot-separated segments so a namespace can match the
// reverse-domain prefix a plugin id must extend (com.gonavi.example-plugin).
var publisherPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,62}(?:[.][a-z][a-z0-9-]{0,62})*$`)

const maxPublisherNamespaceBytes = 200

// UpsertIdentity registers a GitHub identity. A first login self-serves a scoped
// publisher namespace so authors can publish immediately; official certification
// and privileged roles stay operator-owned.
func (p *Postgres) UpsertIdentity(ctx context.Context, identity Identity) (Account, error) {
	if identity.ID == "" || identity.Login == "" {
		return Account{}, ErrInvalid
	}
	namespace, ok := selfServiceNamespace(identity.Login)
	if !ok {
		return Account{}, ErrInvalid
	}
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, repositoryError(err)
	}
	defer rollback(tx)
	inserted, err := tx.ExecContext(ctx, `INSERT INTO market_users(id,login,role,publisher_id,official) VALUES($1,$2,'publisher',$3,false) ON CONFLICT(id) DO NOTHING`, identity.ID, identity.Login, namespace)
	if err != nil {
		return Account{}, repositoryError(err)
	}
	affected, err := inserted.RowsAffected()
	if err != nil {
		return Account{}, repositoryError(err)
	}
	if affected == 1 {
		if err = writeAudit(ctx, tx, "bootstrap:self-service", "account.role", identity.ID, "role=publisher publisher="+namespace); err != nil {
			return Account{}, err
		}
	} else if _, err = tx.ExecContext(ctx, "UPDATE market_users SET login=$2 WHERE id=$1", identity.ID, identity.Login); err != nil {
		return Account{}, repositoryError(err)
	}
	account, err := scanAccount(tx.QueryRowContext(ctx, "SELECT "+accountColumns+" FROM market_users WHERE id=$1", identity.ID))
	if err != nil {
		return account, err
	}
	return account, repositoryError(tx.Commit())
}

// selfServiceNamespace derives a stable namespace from a GitHub login. GitHub
// logins are unique case-insensitively and limited to letters, digits and
// dashes, so the lowercase mapping never collides across accounts.
func selfServiceNamespace(login string) (string, bool) {
	namespace := "gh-" + strings.ToLower(login)
	if len(namespace) > maxPublisherNamespaceBytes || !publisherPattern.MatchString(namespace) {
		return "", false
	}
	return namespace, true
}

// GrantRole is an explicit operator bootstrap operation, not a public signup path.
func (p *Postgres) GrantRole(ctx context.Context, githubID, publisher, role string, official bool) error {
	if !githubIDPattern.MatchString(githubID) || (publisher != "" && (len(publisher) > maxPublisherNamespaceBytes || !publisherPattern.MatchString(publisher))) {
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

// AccountByID returns the stored privileges of one account for operator checks.
func (p *Postgres) AccountByID(ctx context.Context, id string) (Account, error) {
	if !githubIDPattern.MatchString(id) {
		return Account{}, ErrInvalid
	}
	return scanAccount(p.db.QueryRowContext(ctx, "SELECT "+accountColumns+" FROM market_users WHERE id=$1", id))
}

// Session resolves current privileges on every request, including role revocation.
func (p *Postgres) Session(ctx context.Context, hash string, now time.Time) (Account, error) {
	a, err := scanAccount(p.db.QueryRowContext(ctx, `SELECT u.id,u.login,u.role,u.publisher_id,u.official FROM market_sessions s JOIN market_users u ON u.id=s.account_id WHERE token_hash=$1 AND expires_at>$2`, hash, now))
	if errors.Is(err, ErrNotFound) {
		return a, ErrUnauthorized
	}
	return a, err
}

// CreateSession issues one revocable session after a browser login or operator
// issuance. Only the token hash is stored; the raw token never reaches the database.
func (p *Postgres) CreateSession(ctx context.Context, hash, accountID string, expiresAt time.Time) error {
	if hash == "" || accountID == "" || expiresAt.IsZero() {
		return ErrInvalid
	}
	_, err := p.db.ExecContext(ctx, "INSERT INTO market_sessions(token_hash,account_id,expires_at) VALUES($1,$2,$3)", hash, accountID, expiresAt)
	return repositoryError(err)
}

// RevokeSession immediately invalidates a bearer token in every replica.
func (p *Postgres) RevokeSession(ctx context.Context, hash string) error {
	_, err := p.db.ExecContext(ctx, "DELETE FROM market_sessions WHERE token_hash=$1", hash)
	return repositoryError(err)
}

// CreateFlow stores short-lived website PKCE state for replica-safe callbacks.
// Legacy user_code/account_id columns are still NOT NULL, so both are stored empty.
func (p *Postgres) CreateFlow(ctx context.Context, f AuthFlow) error {
	_, err := p.db.ExecContext(ctx, "DELETE FROM market_auth_flows WHERE hash IN (SELECT hash FROM market_auth_flows WHERE expires_at<now() LIMIT 1000)")
	if err != nil {
		return repositoryError(err)
	}
	_, err = p.db.ExecContext(ctx, "INSERT INTO market_auth_flows(hash,kind,verifier,user_code,account_id,expires_at) VALUES($1,$2,$3,'','',$4)", f.Hash, f.Kind, f.Verifier, f.ExpiresAt)
	return repositoryError(err)
}

// ConsumeFlow prevents replay, including concurrent callbacks on separate replicas.
func (p *Postgres) ConsumeFlow(ctx context.Context, hash, kind string, now time.Time) (AuthFlow, error) {
	var f AuthFlow
	err := p.db.QueryRowContext(ctx, `DELETE FROM market_auth_flows WHERE hash=$1 AND kind=$2 AND expires_at>$3 RETURNING hash,kind,verifier,expires_at`, hash, kind, now).Scan(&f.Hash, &f.Kind, &f.Verifier, &f.ExpiresAt)
	return f, repositoryError(err)
}
