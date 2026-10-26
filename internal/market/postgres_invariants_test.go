package market

import (
	"context"
	"testing"

	"golang.org/x/mod/semver"
)

func TestPostgresSemverCompatibilityMatchesGo(t *testing.T) {
	p := postgresFixture(t)
	ctx := context.Background()
	versions := []string{"0.9.9", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.0+build.1", "1.1.0", "10.0.0"}
	for _, left := range versions {
		for _, right := range versions {
			var actual bool
			if err := p.db.QueryRowContext(ctx, "SELECT market_semver_le($1,$2)", left, right).Scan(&actual); err != nil {
				t.Fatal(err)
			}
			expected := semver.Compare("v"+left, "v"+right) <= 0
			if actual != expected {
				t.Errorf("%s <= %s = %t, want %t", left, right, actual, expected)
			}
		}
	}
}

func TestPostgresPublicationRollsBackWhenAuditFails(t *testing.T) {
	p := postgresFixture(t)
	ctx := context.Background()
	publisher := pgAccount(t, p, "1", "publisher", "acme", false)
	admin := pgAccount(t, p, "2", "admin", "", false)
	s := pgSubmit(t, p, publisher, "acme.example", "1.0.0")
	_, err := p.db.ExecContext(ctx, `CREATE FUNCTION test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.action='submission.published' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER test_reject_audit BEFORE INSERT ON market_audit FOR EACH ROW EXECUTE FUNCTION test_reject_audit()`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p.Review(ctx, admin, s.ID, "approve", ""); err == nil {
		t.Fatal("publication ignored failed audit")
	}
	detail, err := p.SubmissionDetail(ctx, admin, s.ID)
	if err != nil || detail.Submission.State != "pending_review" {
		t.Fatal("publication partially committed", err)
	}
	if err = p.GrantRole(ctx, publisher.ID, publisher.PublisherID, "user", false); err != nil {
		t.Fatal(err)
	}
	account, err := p.UpsertIdentity(ctx, Identity{ID: publisher.ID, Login: "author"})
	if err != nil || account.Role != "user" || account.PublisherID != "acme" {
		t.Fatal("role revocation lost ownership", err)
	}
	if _, err = p.BeginSubmission(ctx, account, "acme.example", "2.0.0"); err == nil {
		t.Fatal("revoked publisher submitted")
	}
}
