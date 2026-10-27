package market

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lib/pq"
)

func postgresFixture(t *testing.T) *Postgres {
	t.Helper()
	raw := os.Getenv("GONAVI_MARKET_TEST_POSTGRES")
	if raw == "" {
		t.Skip("set GONAVI_MARKET_TEST_POSTGRES to a disposable local *_test database to run PostgreSQL integration")
	}
	config, err := disposablePostgresConfig(raw)
	if err != nil {
		t.Fatal("integration test requires one effective loopback *_test database without remote overrides")
	}
	connector, err := pq.NewConnectorConfig(config)
	if err != nil {
		t.Fatal("test connector configuration failed")
	}
	admin := sql.OpenDB(connector)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err = admin.PingContext(ctx); err != nil {
		admin.Close()
		t.Fatal("disposable PostgreSQL database unavailable")
	}
	secret, err := newSecret(12)
	if err != nil {
		admin.Close()
		t.Fatal(err)
	}
	schema := "market_test_" + secretHash(secret)[:16]
	if _, err = admin.ExecContext(ctx, "CREATE SCHEMA "+pq.QuoteIdentifier(schema)); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	scopedConfig := config.Clone()
	scopedConfig.Runtime = map[string]string{"search_path": schema}
	scopedConnector, err := pq.NewConnectorConfig(scopedConfig)
	if err != nil {
		t.Fatal("isolated test connector configuration failed")
	}
	db := sql.OpenDB(scopedConnector)
	db.SetMaxOpenConns(5)
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.ExecContext(cleanup, "DROP SCHEMA "+pq.QuoteIdentifier(schema)+" CASCADE"); err != nil {
			t.Error(err)
		}
		if err := admin.Close(); err != nil {
			t.Error(err)
		}
	})
	repo := NewPostgres(db)
	if err = repo.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err = repo.Migrate(ctx); err != nil {
		t.Fatal("migration not idempotent:", err)
	}
	return repo
}

func pgAccount(t *testing.T, p *Postgres, id, role, publisher string, official bool) Account {
	t.Helper()
	ctx := context.Background()
	if _, err := p.UpsertIdentity(ctx, Identity{ID: id, Login: "test-" + id}); err != nil {
		t.Fatal(err)
	}
	if err := p.GrantRole(ctx, id, publisher, role, official); err != nil {
		t.Fatal(err)
	}
	a, err := p.UpsertIdentity(ctx, Identity{ID: id, Login: "test-" + id})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func pgSubmit(t *testing.T, p *Postgres, a Account, id, version string) Submission {
	t.Helper()
	ctx := context.Background()
	s, err := p.BeginSubmission(ctx, a, id, version)
	if err != nil {
		t.Fatal(err)
	}
	for _, state := range []string{"submitted", "validating"} {
		s, err = p.AdvanceSubmission(ctx, a, s.ID, state, "")
		if err != nil {
			t.Fatal(err)
		}
	}
	filename := filepath.Join(t.TempDir(), "plugin.zip")
	if err = os.WriteFile(filename, archiveFixture(t, id, version, ""), 0600); err != nil {
		t.Fatal(err)
	}
	packageData, err := ValidatePackage(ctx, filename)
	if err != nil {
		t.Fatal(err)
	}
	s, err = p.ValidateSubmission(ctx, a, s.ID, packageData)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestPostgresReviewedCatalogAndRatingTransactions(t *testing.T) {
	p := postgresFixture(t)
	ctx := context.Background()
	publisher := pgAccount(t, p, "1", "publisher", "acme", true)
	admin := pgAccount(t, p, "2", "admin", "", false)
	user := pgAccount(t, p, "3", "user", "", false)
	s := pgSubmit(t, p, publisher, "acme.example", "1.0.0")
	if _, err := p.Plugin(ctx, "acme.example"); !errors.Is(err, ErrNotFound) {
		t.Fatal("pending version public", err)
	}
	if _, err := p.Review(ctx, publisher, s.ID, "approve", ""); !errors.Is(err, ErrForbidden) {
		t.Fatal("publisher approved release", err)
	}
	if _, err := p.Review(ctx, admin, s.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := p.BeginSubmission(ctx, publisher, "acme.example", "1.0.0"); !errors.Is(err, ErrConflict) {
		t.Fatal("version replaced", err)
	}
	if _, err := p.db.ExecContext(ctx, "UPDATE market_versions SET sha256=$1 WHERE id=$2", strings.Repeat("0", 64), s.ID); err == nil {
		t.Fatal("database allowed released bytes to change")
	}
	if _, err := p.PutRating(ctx, publisher, Rating{PluginID: "acme.example", Stars: 5}); !errors.Is(err, ErrForbidden) {
		t.Fatal("author rated own release", err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := p.PutRating(ctx, user, Rating{PluginID: "acme.example", Stars: 4}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	detail, err := p.Plugin(ctx, "acme.example")
	if err != nil || detail.RatingCount != 1 || detail.RatingAverage != 4 || !detail.Official {
		t.Fatalf("detail=%+v err=%v", detail, err)
	}
	page, err := p.Catalog(ctx, CatalogQuery{Limit: 24, Sort: "rating", HostVersion: "1.0.0", Platform: "linux/amd64"})
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("catalog=%+v err=%v", page, err)
	}
	if err = p.HideRating(ctx, admin, "acme.example", user.ID, "abuse"); err != nil {
		t.Fatal(err)
	}
	if _, err = p.PutRating(ctx, user, Rating{PluginID: "acme.example", Stars: 5}); err != nil {
		t.Fatal(err)
	}
	detail, err = p.Plugin(ctx, "acme.example")
	if err != nil || detail.RatingCount != 0 {
		t.Fatal("hidden aggregate counted", err)
	}
	if err = p.DeleteRating(ctx, user, "acme.example"); err != nil {
		t.Fatal(err)
	}
	if _, err = p.PutRating(ctx, user, Rating{PluginID: "acme.example", Stars: 5, Body: "recreated"}); err != nil {
		t.Fatal(err)
	}
	detail, err = p.Plugin(ctx, "acme.example")
	if err != nil || detail.RatingCount != 0 {
		t.Fatal("delete/recreate bypassed moderation", err)
	}
	if _, err = p.Review(ctx, admin, s.ID, "yank", "security"); err != nil {
		t.Fatal(err)
	}
	if _, err = p.PublishedArtifact(ctx, s.SHA256); !errors.Is(err, ErrNotFound) {
		t.Fatal("yanked artifact public", err)
	}
	audits, err := p.Audits(ctx, admin)
	if err != nil || len(audits) < 10 {
		t.Fatal("missing transactional audit", err)
	}
}

func TestPostgresSessionsAndOAuthFlows(t *testing.T) {
	p := postgresFixture(t)
	ctx := context.Background()
	a, err := p.UpsertIdentity(ctx, Identity{ID: "42", Login: "first"})
	// 自助登录即分配 gh-<login> 发布命名空间与 publisher 角色（官方认证仍需 GrantRole）。
	if err != nil || a.Role != "publisher" || a.PublisherID != "gh-first" || a.Official {
		t.Fatalf("first signup=%+v err=%v", a, err)
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	tokenHash := secretHash("operator-token")
	if err = p.CreateSession(ctx, tokenHash, a.ID, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	account, err := p.Session(ctx, tokenHash, now)
	if err != nil || account.ID != a.ID || account.Role != "publisher" {
		t.Fatalf("issued session=%+v err=%v", account, err)
	}
	if err = p.RevokeSession(ctx, tokenHash); err != nil {
		t.Fatal(err)
	}
	if _, err = p.Session(ctx, tokenHash, now); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("revoked session accepted", err)
	}
	// OAuth flows keep the legacy user_code/account_id columns empty and are single-use.
	flow := AuthFlow{Hash: secretHash("oauth-state"), Kind: "oauth", Verifier: "verifier", ExpiresAt: now.Add(10 * time.Minute)}
	if err = p.CreateFlow(ctx, flow); err != nil {
		t.Fatal(err)
	}
	consumed, err := p.ConsumeFlow(ctx, flow.Hash, "oauth", now)
	if err != nil || consumed.Verifier != flow.Verifier {
		t.Fatalf("consumed flow=%+v err=%v", consumed, err)
	}
	if _, err = p.ConsumeFlow(ctx, flow.Hash, "oauth", now); !errors.Is(err, ErrNotFound) {
		t.Fatal("replayed oauth flow accepted", err)
	}
}

func TestPostgresOwnerPluginDeletePurgesReleasedRows(t *testing.T) {
	p := postgresFixture(t)
	ctx := context.Background()
	publisher := pgAccount(t, p, "1", "publisher", "acme", false)
	admin := pgAccount(t, p, "2", "admin", "", false)
	user := pgAccount(t, p, "3", "user", "", false)
	other := pgAccount(t, p, "4", "publisher", "other", false)
	approved := func(id, version string) {
		s := pgSubmit(t, p, publisher, id, version)
		if _, err := p.Review(ctx, admin, s.ID, "approve", ""); err != nil {
			t.Fatal(err)
		}
	}
	approved("acme.example", "1.0.0")
	approved("acme.retained", "1.0.0")
	if _, err := p.PutRating(ctx, user, Rating{PluginID: "acme.example", Stars: 4, Body: "good"}); err != nil {
		t.Fatal(err)
	}
	if err := p.Report(ctx, user, Report{PluginID: "acme.example", Reason: "spam"}); err != nil {
		t.Fatal(err)
	}
	// Without the transaction-local purge setting, released versions stay undeletable.
	if _, err := p.db.ExecContext(ctx, "DELETE FROM market_versions WHERE plugin_id=$1", "acme.example"); err == nil {
		t.Fatal("release trigger allowed a delete without purge")
	}
	if err := p.DeletePlugin(ctx, other, "acme.example"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-owner delete err=%v", err)
	}
	if err := p.DeletePlugin(ctx, publisher, "acme.missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing plugin delete err=%v", err)
	}
	if err := p.DeletePlugin(ctx, publisher, "acme.example"); err != nil {
		t.Fatal(err)
	}
	checks := map[string]string{
		"SELECT count(*) FROM market_versions WHERE plugin_id=$1": "versions",
		"SELECT count(*) FROM market_ratings WHERE plugin_id=$1":  "ratings",
		"SELECT count(*) FROM market_reports WHERE plugin_id=$1":  "reports",
		"SELECT count(*) FROM market_plugins WHERE id=$1":         "plugins",
	}
	for query, label := range checks {
		var count int
		if err := p.db.QueryRowContext(ctx, query, "acme.example").Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s rows survived the purge: %d", label, count)
		}
	}
	var actor, action, subject, reason string
	if err := p.db.QueryRowContext(ctx, "SELECT actor_id,action,subject,reason FROM market_audit WHERE action='plugin.delete' ORDER BY id DESC LIMIT 1").Scan(&actor, &action, &subject, &reason); err != nil {
		t.Fatal(err)
	}
	if actor != publisher.ID || subject != "acme.example" || reason != "owner delete" {
		t.Fatalf("audit=%s/%s/%s", actor, subject, reason)
	}
	if _, err := p.Plugin(ctx, "acme.example"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted plugin still public: %v", err)
	}
	// The released reservation is gone, so the same plugin/version can return.
	if _, err := p.BeginSubmission(ctx, publisher, "acme.example", "1.0.0"); err != nil {
		t.Fatal("purged identity not reusable:", err)
	}
	// SET LOCAL never leaks: the next direct delete is still blocked.
	if _, err := p.db.ExecContext(ctx, "DELETE FROM market_versions WHERE plugin_id=$1", "acme.retained"); err == nil {
		t.Fatal("purge setting leaked outside its transaction")
	}
	if err := p.DeletePlugin(ctx, admin, "acme.retained"); err != nil {
		t.Fatal("admin override failed:", err)
	}
	if _, err := p.Plugin(ctx, "acme.retained"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("admin-deleted plugin still public: %v", err)
	}
	if err := p.db.QueryRowContext(ctx, "SELECT actor_id FROM market_audit WHERE action='plugin.delete' ORDER BY id DESC LIMIT 1").Scan(&actor); err != nil || actor != admin.ID {
		t.Fatalf("admin audit actor=%s err=%v", actor, err)
	}
}
