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

func TestPostgresDeviceSingleConsumptionAndExplicitRoles(t *testing.T) {
	p := postgresFixture(t)
	ctx := context.Background()
	a, err := p.UpsertIdentity(ctx, Identity{ID: "42", Login: "first"})
	if err != nil || a.Role != "user" || a.Official {
		t.Fatalf("first signup=%+v err=%v", a, err)
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	d := DeviceGrant{CodeHash: secretHash("device"), UserCodeHash: secretHash("user-code"), ExpiresAt: now.Add(time.Minute), NextPollAt: now}
	if err = p.CreateDevice(ctx, d); err != nil {
		t.Fatal(err)
	}
	if err = p.DecideDevice(ctx, d.UserCodeHash, a.ID, true, now); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan string, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			state, pollErr := p.PollDevice(ctx, d.CodeHash, secretHash("session"), now, now.Add(time.Hour))
			if pollErr != nil {
				t.Error(pollErr)
			}
			results <- state
		}()
	}
	wg.Wait()
	close(results)
	authorized := 0
	for state := range results {
		if state == "authorized" {
			authorized++
		}
	}
	if authorized != 1 {
		t.Fatalf("issued %d sessions", authorized)
	}
	if _, err = p.Session(ctx, secretHash("session"), now); err != nil {
		t.Fatal(err)
	}
	if err = p.RevokeSession(ctx, secretHash("session")); err != nil {
		t.Fatal(err)
	}
	if _, err = p.Session(ctx, secretHash("session"), now); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("revoked session accepted", err)
	}
}
