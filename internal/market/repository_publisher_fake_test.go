package market

import (
	"context"
	"sort"
	"time"
)

// ClearPluginSource mirrors the production clear path in the in-memory fixture.
func (m *memoryRepo) ClearPluginSource(ctx context.Context, owner Account, pluginID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	found := false
	for id, v := range m.releases {
		if v.submission.PluginID != pluginID || v.owner != owner.ID {
			continue
		}
		v.sourceURL = ""
		m.releases[id] = v
		found = true
	}
	if !found {
		return ErrNotFound
	}
	return nil
}

// PublisherPlugins groups the fixture's releases into one row per owned plugin.
// Ordering mirrors publisherPluginQuery: newest overall by updated_at then id,
// newest published version independently, with the published name as fallback.
func (m *memoryRepo) PublisherPlugins(ctx context.Context, a Account, q PublisherQuery) (PublisherPluginPage, error) {
	page := PublisherPluginPage{Items: []PublisherPlugin{}}
	if a.ID == "" || q.Limit < 1 || q.Offset < 0 {
		return page, ErrInvalid
	}
	type mark struct {
		at time.Time
		id string
	}
	newer := func(v testRelease, current mark) bool {
		return v.submission.UpdatedAt.After(current.at) || (v.submission.UpdatedAt.Equal(current.at) && v.submission.ID > current.id)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	newestMark := map[string]mark{}
	publishedMark := map[string]mark{}
	publishedName := map[string]string{}
	latest := map[string]PublisherPlugin{}
	for _, v := range m.releases {
		if v.owner != a.ID {
			continue
		}
		id := v.submission.PluginID
		if q.PluginID != "" && id != q.PluginID {
			continue
		}
		item, ok := latest[id]
		if !ok {
			item = PublisherPlugin{ID: id}
		}
		if v.sourceURL != "" {
			item.SourceURL = v.sourceURL
		}
		if current, seen := newestMark[id]; !seen || newer(v, current) {
			newestMark[id] = mark{at: v.submission.UpdatedAt, id: v.submission.ID}
			item.LatestVersion = v.submission.Version
			item.LatestState = v.submission.State
			item.Name = v.packageData.Name
		}
		if v.submission.State == "published" {
			if current, seen := publishedMark[id]; !seen || newer(v, current) {
				publishedMark[id] = mark{at: v.submission.UpdatedAt, id: v.submission.ID}
				item.PublishedVersion = v.submission.Version
				publishedName[id] = v.packageData.Name
			}
		}
		latest[id] = item
	}
	items := make([]PublisherPlugin, 0, len(latest))
	for id, item := range latest {
		if item.Name == "" {
			item.Name = publishedName[id]
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	if q.Offset < len(items) {
		items = items[q.Offset:]
		page.NextCursor = publishCursor(q.Offset, q.Limit, len(items))
		if len(items) > q.Limit {
			items = items[:q.Limit]
		}
		page.Items = items
	}
	return page, nil
}

// PublisherSubmissions pages the fixture's owner-scoped submission history.
func (m *memoryRepo) PublisherSubmissions(ctx context.Context, a Account, q PublisherQuery) (PublisherSubmissionPage, error) {
	page := PublisherSubmissionPage{Items: []Submission{}}
	if a.ID == "" || q.Limit < 1 || q.Offset < 0 {
		return page, ErrInvalid
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	items := []Submission{}
	for _, v := range m.releases {
		if v.owner != a.ID {
			continue
		}
		if q.PluginID != "" && v.submission.PluginID != q.PluginID {
			continue
		}
		items = append(items, v.submission)
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			return items[i].UpdatedAt.After(items[j].UpdatedAt)
		}
		return items[i].ID > items[j].ID
	})
	if q.Offset < len(items) {
		items = items[q.Offset:]
		page.NextCursor = publishCursor(q.Offset, q.Limit, len(items))
		if len(items) > q.Limit {
			items = items[:q.Limit]
		}
		page.Items = items
	}
	return page, nil
}

// DeletePlugin mirrors the production purge: every fixture row that belongs to
// the plugin is removed and an audit event records the owner delete.
func (m *memoryRepo) DeletePlugin(ctx context.Context, a Account, pluginID string) error {
	if a.ID == "" {
		return ErrUnauthorized
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	owner := ""
	found := false
	for _, v := range m.releases {
		if v.submission.PluginID == pluginID {
			owner, found = v.owner, true
			break
		}
	}
	if !found {
		return ErrNotFound
	}
	if owner != a.ID && a.Role != "admin" {
		return ErrForbidden
	}
	for id, v := range m.releases {
		if v.submission.PluginID == pluginID {
			delete(m.releases, id)
		}
	}
	for key, rating := range m.ratings {
		if rating.PluginID == pluginID {
			delete(m.ratings, key)
			delete(m.hidden, key)
		}
	}
	delete(m.downloads, pluginID)
	m.addAudit(a.ID, "plugin.delete", pluginID, "owner delete")
	return nil
}
