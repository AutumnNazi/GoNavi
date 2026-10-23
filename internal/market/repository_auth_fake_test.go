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

func (m *memoryRepo) CreateDevice(ctx context.Context, d DeviceGrant) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.devices[d.CodeHash] = d
	return nil
}

func (m *memoryRepo) PollDevice(ctx context.Context, hash, sessionHash string, now, expires time.Time) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.devices[hash]
	if !ok || !d.ExpiresAt.After(now) || d.State == "consumed" {
		return "expired", nil
	}
	if d.NextPollAt.After(now) {
		return "slow_down", nil
	}
	d.NextPollAt = now.Add(5 * time.Second)
	state := d.State
	if d.State == "authorized" {
		m.sessions[sessionHash] = testSession{accountID: d.AccountID, expires: expires}
		d.State = "consumed"
	}
	m.devices[hash] = d
	return state, nil
}

func (m *memoryRepo) DecideDevice(ctx context.Context, userHash, account string, approve bool, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for hash, d := range m.devices {
		if d.UserCodeHash == userHash && d.State == "pending" && d.ExpiresAt.After(now) {
			d.State = "denied"
			if approve {
				d.State = "authorized"
			}
			d.AccountID = account
			m.devices[hash] = d
			return nil
		}
	}
	return ErrNotFound
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
