package market

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"golang.org/x/mod/semver"
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
	inheritedSource := ""
	for _, v := range m.releases {
		if v.submission.PluginID == id && v.owner != a.ID {
			return Submission{}, ErrForbidden
		}
		if v.submission.PluginID == id && v.submission.Version == version {
			return Submission{}, ErrConflict
		}
		if v.submission.PluginID == id && v.sourceURL != "" {
			inheritedSource = v.sourceURL
		}
	}
	now := time.Now().UTC()
	s := Submission{ID: fmt.Sprint(len(m.releases) + 1), PluginID: id, Version: version, State: "draft", PublisherID: a.PublisherID, CreatedAt: now, UpdatedAt: now}
	m.releases[s.ID] = testRelease{submission: s, owner: a.ID, sourceURL: inheritedSource}
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

func (m *memoryRepo) SelfPublish(ctx context.Context, a Account, id string) (Submission, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if a.Role != "publisher" && a.Role != "admin" {
		return Submission{}, ErrForbidden
	}
	v, ok := m.releases[id]
	if !ok {
		return Submission{}, ErrNotFound
	}
	if v.owner != a.ID {
		return Submission{}, ErrForbidden
	}
	if v.submission.State != "pending_review" || v.submission.SHA256 == "" {
		return Submission{}, ErrConflict
	}
	v.submission.State = "published"
	v.submission.UpdatedAt = time.Now().UTC()
	m.releases[id] = v
	m.addAudit(a.ID, "submission.published", id, "self-service publication")
	return v.submission, nil
}

func (m *memoryRepo) SourcePlugins(ctx context.Context) ([]SourcePlugin, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := []SourcePlugin{}
	seen := map[string]bool{}
	for _, v := range m.releases {
		if v.sourceURL == "" || seen[v.submission.PluginID] {
			continue
		}
		seen[v.submission.PluginID] = true
		latest := ""
		for _, other := range m.releases {
			if other.submission.PluginID == v.submission.PluginID && other.submission.State == "published" && semver.Compare("v"+other.submission.Version, "v"+latest) > 0 {
				latest = other.submission.Version
			}
		}
		result = append(result, SourcePlugin{PluginID: v.submission.PluginID, SourceURL: v.sourceURL, Owner: m.accounts[v.owner], PublishedVersion: latest})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].PluginID < result[j].PluginID })
	return result, nil
}

func (m *memoryRepo) SetPluginSource(ctx context.Context, owner Account, pluginID, sourceURL string) error {
	if _, _, err := parseRepositoryURL(sourceURL); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	found := false
	for id, v := range m.releases {
		if v.submission.PluginID != pluginID || v.owner != owner.ID {
			continue
		}
		v.sourceURL = sourceURL
		m.releases[id] = v
		found = true
	}
	if !found {
		return ErrNotFound
	}
	return nil
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
