package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/market"
)

type operatorStub struct {
	account   market.Account
	lookupErr error
	storeErr  error
	lookups   int
	stores    int
	hash      string
	accountID string
	expires   time.Time
}

func (s *operatorStub) AccountByID(context.Context, string) (market.Account, error) {
	s.lookups++
	return s.account, s.lookupErr
}

func (s *operatorStub) CreateSession(_ context.Context, hash, accountID string, expiresAt time.Time) error {
	s.stores++
	s.hash, s.accountID, s.expires = hash, accountID, expiresAt
	return s.storeErr
}

func TestOperatorTokenIsRandomSHA256Hex(t *testing.T) {
	token, hash, err := newOperatorToken()
	if err != nil {
		t.Fatal(err)
	}
	raw, decodeErr := base64.RawURLEncoding.DecodeString(token)
	if decodeErr != nil || len(raw) != 32 || len(token) != 43 {
		t.Fatalf("token=%q decodeErr=%v", token, decodeErr)
	}
	digest := sha256.Sum256([]byte(token))
	if hash != hex.EncodeToString(digest[:]) || len(hash) != 64 {
		t.Fatal("stored hash is not the SHA-256 hex of the raw token")
	}
	other, _, err := newOperatorToken()
	if err != nil || other == token {
		t.Fatal("operator tokens are not unique")
	}
}

func TestSessionTTLBounds(t *testing.T) {
	cases := map[time.Duration]bool{
		0:                           false,
		-1 * time.Hour:              false,
		59 * time.Minute:            false,
		minSessionTTL:               true,
		defaultSessionTTL:           true,
		maxSessionTTL:               true,
		maxSessionTTL + time.Second: false,
	}
	for ttl, valid := range cases {
		if err := validateSessionTTL(ttl); (err == nil) != valid {
			t.Fatalf("ttl=%s valid=%t err=%v", ttl, valid, err)
		}
	}
}

func TestIssueOperatorSessionPrintsTokenOnce(t *testing.T) {
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	repo := &operatorStub{account: market.Account{ID: "42", Login: "ops", Role: "admin"}}
	var out strings.Builder
	if err := issueOperatorSession(context.Background(), repo, "42", defaultSessionTTL, func() time.Time { return now }, &out); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(out.String(), "\n"), "\n")
	if len(lines) != 1 || len(lines[0]) != 43 {
		t.Fatalf("stdout=%q", out.String())
	}
	token := lines[0]
	digest := sha256.Sum256([]byte(token))
	if repo.hash != hex.EncodeToString(digest[:]) || repo.accountID != "42" {
		t.Fatalf("stored hash=%q account=%q", repo.hash, repo.accountID)
	}
	if !repo.expires.Equal(now.Add(defaultSessionTTL)) {
		t.Fatalf("expires=%s", repo.expires)
	}
	if strings.Contains(repo.hash, token) {
		t.Fatal("repository received the raw token")
	}
}

func TestIssueOperatorSessionRejectsUnknownAccountAndInvalidTTL(t *testing.T) {
	var out strings.Builder
	missing := &operatorStub{lookupErr: errors.New("no rows")}
	if err := issueOperatorSession(context.Background(), missing, "7", defaultSessionTTL, time.Now, &out); err == nil {
		t.Fatal("unknown account received a token")
	}
	if missing.stores != 0 || out.Len() != 0 {
		t.Fatal("unknown account printed or stored a token")
	}
	invalid := &operatorStub{account: market.Account{ID: "42"}}
	if err := issueOperatorSession(context.Background(), invalid, "42", time.Minute, time.Now, &out); err == nil {
		t.Fatal("out-of-range TTL accepted")
	}
	if invalid.lookups != 0 || invalid.stores != 0 || out.Len() != 0 {
		t.Fatal("invalid TTL reached account lookup or storage")
	}
	if err := issueOperatorSession(context.Background(), &operatorStub{account: market.Account{ID: "42"}, storeErr: errors.New("db down")}, "42", time.Hour, time.Now, &out); err == nil {
		t.Fatal("storage failure reported success")
	}
	if out.Len() != 0 {
		t.Fatal("storage failure printed a token")
	}
}
