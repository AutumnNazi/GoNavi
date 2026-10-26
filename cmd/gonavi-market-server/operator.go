package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"time"

	"GoNavi-Wails/internal/market"
)

const (
	// defaultSessionTTL is one operator month; bounds keep a leaked token from
	// living indefinitely while still allowing long-lived automation.
	defaultSessionTTL = 720 * time.Hour
	minSessionTTL     = time.Hour
	maxSessionTTL     = 8760 * time.Hour
)

// sessionIssuer is the narrow operator surface: resolve an existing account and
// store a hashed session. It never exposes a database handle, DSN or raw token.
type sessionIssuer interface {
	AccountByID(context.Context, string) (market.Account, error)
	CreateSession(context.Context, string, string, time.Time) error
}

func validateSessionTTL(ttl time.Duration) error {
	if ttl < minSessionTTL || ttl > maxSessionTTL {
		return errors.New("session TTL must be between 1h and 8760h")
	}
	return nil
}

// newOperatorToken returns a 256-bit base64url bearer secret and the SHA-256 hex
// hash stored in market_sessions. The raw value is printed once and never stored.
func newOperatorToken() (token, hash string, err error) {
	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return "", "", errors.New("operator token generation failed")
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	digest := sha256.Sum256([]byte(token))
	return token, hex.EncodeToString(digest[:]), nil
}

// issueOperatorSession provisions one revocable bearer session for an existing
// account, sharing market_sessions with website logins. Only the hash is stored;
// the raw token is written to out exactly once.
func issueOperatorSession(ctx context.Context, repo sessionIssuer, githubID string, ttl time.Duration, now func() time.Time, out io.Writer) error {
	if err := validateSessionTTL(ttl); err != nil {
		return err
	}
	account, err := repo.AccountByID(ctx, githubID)
	if err != nil {
		return errors.New("account lookup failed; grant a role to this GitHub ID first")
	}
	token, hash, err := newOperatorToken()
	if err != nil {
		return err
	}
	if err = repo.CreateSession(ctx, hash, account.ID, now().Add(ttl)); err != nil {
		return errors.New("operator session could not be stored")
	}
	if _, err = fmt.Fprintln(out, token); err != nil {
		return errors.New("operator token could not be written")
	}
	return nil
}
