package market

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"sort"

	"github.com/lib/pq"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Postgres implements repository invariants with PostgreSQL transactions and constraints.
type Postgres struct{ db *sql.DB }

var _ Repository = (*Postgres)(nil)

// NewPostgres uses an existing pool; callers own pool lifetime and connection settings.
func NewPostgres(db *sql.DB) *Postgres { return &Postgres{db: db} }

// Migrate applies bundled migrations once under a transaction-scoped advisory lock.
func (p *Postgres) Migrate(ctx context.Context) error {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration: %w", err)
	}
	defer rollback(tx)
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(426724031)"); err != nil {
		return fmt.Errorf("lock migration: %w", err)
	}
	if _, err = tx.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS market_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		return fmt.Errorf("create migration ledger: %w", err)
	}
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		var exists bool
		if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM market_migrations WHERE name=$1)", entry.Name()).Scan(&exists); err != nil {
			return fmt.Errorf("read migration ledger: %w", err)
		}
		if exists {
			continue
		}
		body, readErr := migrations.ReadFile("migrations/" + entry.Name())
		if readErr != nil {
			return fmt.Errorf("read migration: %w", readErr)
		}
		if _, err = tx.ExecContext(ctx, string(body)); err != nil {
			return fmt.Errorf("apply migration %s: %w", entry.Name(), err)
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO market_migrations(name) VALUES($1)", entry.Name()); err != nil {
			return fmt.Errorf("record migration: %w", err)
		}
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit migration: %w", err)
	}
	return nil
}

func rollback(tx *sql.Tx) {
	// Rollback is best effort after a failed operation; an earlier error remains primary.
	if err := tx.Rollback(); err != nil && !errors.Is(err, sql.ErrTxDone) {
		return
	}
}

func repositoryError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	var pg *pq.Error
	if errors.As(err, &pg) && pg.Code == "23505" {
		return ErrConflict
	}
	return fmt.Errorf("market repository: %w", err)
}

type scanner interface{ Scan(...any) error }

func scanAccount(row scanner) (Account, error) {
	var a Account
	err := row.Scan(&a.ID, &a.Login, &a.Role, &a.PublisherID, &a.Official)
	return a, repositoryError(err)
}

func writeAudit(ctx context.Context, tx *sql.Tx, actor, action, subject, reason string) error {
	_, err := tx.ExecContext(ctx, "INSERT INTO market_audit(actor_id,action,subject,reason) VALUES($1,$2,$3,$4)", actor, action, subject, reason)
	return repositoryError(err)
}
