package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"

	"GoNavi-Wails/internal/plugin"
	"GoNavi-Wails/internal/pluginmarket"
)

const marketApprovalLifetime = 10 * time.Minute
const maxMarketApprovals = 4

type marketInstallApproval struct {
	token          string
	id             string
	version        string
	artifactDigest string
	sourceID       string
	path           string
	contentDigest  string
	previousDigest string
	expires        time.Time
	service        *pluginmarket.Service
	cleanup        func()
	timer          *time.Timer
	once           sync.Once
}

func (q *marketInstallApproval) dispose() {
	if q == nil {
		return
	}
	if q.timer != nil {
		q.timer.Stop()
	}
	q.once.Do(func() {
		if q.cleanup != nil {
			q.cleanup()
		}
	})
}

// PluginMarketInspection is an actual package inspection, not a server-authored permission claim.
type PluginMarketInspection struct {
	Inspection     plugin.Inspection `json:"inspection"`
	SourceID       string            `json:"sourceId"`
	ArtifactDigest string            `json:"artifactDigest"`
	ApprovalToken  string            `json:"approvalToken"`
	ExpiresAt      time.Time         `json:"expiresAt"`
}

func (a *App) registerMarketApproval(ctx context.Context, q *marketInstallApproval) (string, error) {
	var entropy [32]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return "", err
	}
	token := hex.EncodeToString(entropy[:])
	state := &a.pluginMarket
	state.mu.Lock()
	defer state.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if state.closing || len(state.approvals) >= maxMarketApprovals {
		return "", errors.New("market inspection capacity unavailable")
	}
	if state.approvals == nil {
		state.approvals = make(map[string]*marketInstallApproval)
	}
	q.token, q.expires = token, time.Now().Add(marketApprovalLifetime)
	state.approvals[token] = q
	q.timer = time.AfterFunc(marketApprovalLifetime, func() { a.cancelMarketApproval(token) })
	return token, nil
}

func (a *App) cancelMarketApproval(token string) {
	state := &a.pluginMarket
	state.mu.Lock()
	q := state.approvals[token]
	delete(state.approvals, token)
	state.mu.Unlock()
	if q != nil {
		q.dispose()
	}
}

func (a *App) takeMarketApproval(ctx context.Context, id, version, digest, token string) (*marketInstallApproval, error) {
	if ctx == nil {
		return nil, context.Canceled
	}
	state := &a.pluginMarket
	state.mu.Lock()
	q := state.approvals[token]
	if state.closing || ctx.Err() != nil || q == nil || q.id != id || q.version != version || q.artifactDigest != digest {
		state.mu.Unlock()
		return nil, errors.New("market inspection approval unavailable")
	}
	delete(state.approvals, token)
	expired := !time.Now().Before(q.expires)
	if q.timer != nil {
		q.timer.Stop()
	}
	state.mu.Unlock()
	if expired {
		q.dispose()
		return nil, errors.New("market inspection expired")
	}
	return q, nil
}

func marketApprovalSource(s *pluginmarket.Service, q *marketInstallApproval) error {
	if s != q.service {
		return pluginmarket.ErrSourceChanged
	}
	currentSource, err := s.CurrentSourceID()
	if err != nil {
		return err
	}
	source, err := s.DownloadSourceID(q.path)
	if err != nil {
		return err
	}
	if source != q.sourceID || currentSource != q.sourceID {
		return pluginmarket.ErrSourceChanged
	}
	return nil
}
