package market

import (
	"context"
	"time"
)

func (m *memoryRepo) UpsertIdentity(ctx context.Context, i Identity) (Account, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.accounts[i.ID]
	if !ok {
		a = Account{ID: i.ID, Role: "user"}
	}
	a.Login = i.Login
	m.accounts[i.ID] = a
	return a, nil
}

func (m *memoryRepo) Session(ctx context.Context, hash string, now time.Time) (Account, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[hash]
	if !ok || !session.expires.After(now) {
		return Account{}, ErrUnauthorized
	}
	return m.accounts[session.accountID], nil
}

func (m *memoryRepo) RevokeSession(ctx context.Context, hash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, hash)
	return nil
}

func (m *memoryRepo) CreateSession(ctx context.Context, hash, accountID string, expiresAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if hash == "" || accountID == "" {
		return ErrInvalid
	}
	m.sessions[hash] = testSession{accountID: accountID, expires: expiresAt}
	return nil
}

func (m *memoryRepo) CreateFlow(ctx context.Context, f AuthFlow) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.flows[f.Hash] = f
	return nil
}

func (m *memoryRepo) ConsumeFlow(ctx context.Context, hash, kind string, now time.Time) (AuthFlow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	f, ok := m.flows[hash]
	if !ok || f.Kind != kind || !f.ExpiresAt.After(now) {
		return f, ErrNotFound
	}
	delete(m.flows, hash)
	return f, nil
}
