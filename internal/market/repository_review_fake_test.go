package market

import (
	"context"
	"fmt"
	"strings"
	"time"
)

func (m *memoryRepo) BeginSubmission(ctx context.Context, a Account, id, version string) (Submission, error) {
	if a.Role != "publisher" && a.Role != "admin" {
		return Submission{}, ErrForbidden
	}
	if !strings.HasPrefix(id, a.PublisherID+".") {
		return Submission{}, ErrForbidden
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, v := range m.releases {
		if v.submission.PluginID == id && v.owner != a.ID {
			return Submission{}, ErrForbidden
		}
		if v.submission.PluginID == id && v.submission.Version == version {
			return Submission{}, ErrConflict
		}
	}
	now := time.Now().UTC()
	s := Submission{ID: fmt.Sprint(len(m.releases) + 1), PluginID: id, Version: version, State: "draft", PublisherID: a.PublisherID, CreatedAt: now, UpdatedAt: now}
	m.releases[s.ID] = testRelease{submission: s, owner: a.ID}
	m.addAudit(a.ID, "submission.draft", s.ID, "")
	return s, nil
}

func (m *memoryRepo) addAudit(actor, action, id, reason string) {
	m.audit = append(m.audit, Audit{ID: int64(len(m.audit) + 1), ActorID: actor, Action: action, Subject: id, Reason: reason, CreatedAt: time.Now().UTC()})
}

func (m *memoryRepo) AdvanceSubmission(ctx context.Context, a Account, id, state, reason string) (Submission, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.releases[id]
	if !ok {
		return Submission{}, ErrNotFound
	}
	if v.owner != a.ID {
		return Submission{}, ErrForbidden
	}
	allowed := (v.submission.State == "draft" && state == "submitted") || (v.submission.State == "submitted" && state == "validating") || (v.submission.State == "validating" && state == "rejected")
	if !allowed {
		return Submission{}, ErrConflict
	}
	v.submission.State = state
	v.submission.Reason = reason
	v.submission.UpdatedAt = time.Now().UTC()
	m.releases[id] = v
	m.addAudit(a.ID, "submission."+state, id, reason)
	return v.submission, nil
}

func (m *memoryRepo) ValidateSubmission(ctx context.Context, a Account, id string, p ValidatedPackage) (Submission, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.releases[id]
	if !ok {
		return Submission{}, ErrNotFound
	}
	if v.owner != a.ID {
		return Submission{}, ErrForbidden
	}
	if v.submission.State != "validating" {
		return Submission{}, ErrConflict
	}
	if v.submission.PluginID != p.ID || v.submission.Version != p.Version {
		return Submission{}, ErrInvalid
	}
	v.packageData = p
	v.submission.State = "pending_review"
	v.submission.SHA256 = p.SHA256
	v.submission.UpdatedAt = time.Now().UTC()
	m.releases[id] = v
	m.addAudit(a.ID, "submission.pending_review", id, "")
	return v.submission, nil
}

func (m *memoryRepo) Submissions(ctx context.Context, a Account) ([]Submission, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if a.Role != "publisher" && a.Role != "admin" {
		return nil, ErrForbidden
	}
	items := []Submission{}
	for _, v := range m.releases {
		if a.Role == "admin" || v.owner == a.ID {
			items = append(items, v.submission)
		}
	}
	return items, nil
}

func (m *memoryRepo) Review(ctx context.Context, a Account, id, action, reason string) (Submission, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if a.Role != "admin" {
		return Submission{}, ErrForbidden
	}
	v, ok := m.releases[id]
	if !ok {
		return Submission{}, ErrNotFound
	}
	state := ""
	switch {
	case action == "approve" && v.submission.State == "pending_review":
		if v.owner == a.ID {
			return Submission{}, ErrForbidden
		}
		state = "published"
	case action == "reject" && v.submission.State == "pending_review":
		state = "rejected"
	case action == "yank" && v.submission.State == "published":
		state = "yanked"
	default:
		return Submission{}, ErrConflict
	}
	if action != "approve" && reason == "" {
		return Submission{}, ErrInvalid
	}
	v.submission.State = state
	v.submission.UpdatedAt = time.Now().UTC()
	v.submission.Reason = reason
	m.releases[id] = v
	m.addAudit(a.ID, "submission."+state, id, reason)
	return v.submission, nil
}

func (m *memoryRepo) Audits(ctx context.Context, a Account) ([]Audit, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if a.Role != "admin" {
		return nil, ErrForbidden
	}
	return append([]Audit(nil), m.audit...), nil
}
