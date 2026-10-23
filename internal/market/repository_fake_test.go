package market

import (
	"context"
	"encoding/base64"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/mod/semver"
)

type testRelease struct {
	submission  Submission
	packageData ValidatedPackage
	owner       string
}
type testSession struct {
	accountID string
	expires   time.Time
}

type memoryRepo struct {
	mu        sync.Mutex
	accounts  map[string]Account
	sessions  map[string]testSession
	devices   map[string]DeviceGrant
	flows     map[string]AuthFlow
	releases  map[string]testRelease
	ratings   map[string]Rating
	hidden    map[string]bool
	downloads map[string]int64
	audit     []Audit
}

var _ Repository = (*memoryRepo)(nil)

func newMemoryRepo() *memoryRepo {
	return &memoryRepo{accounts: map[string]Account{}, sessions: map[string]testSession{}, devices: map[string]DeviceGrant{}, flows: map[string]AuthFlow{},
		releases: map[string]testRelease{}, ratings: map[string]Rating{}, hidden: map[string]bool{}, downloads: map[string]int64{}}
}

func (m *memoryRepo) published(id string) bool {
	for _, v := range m.releases {
		if v.submission.PluginID == id && v.submission.State == "published" {
			return true
		}
	}
	return false
}

func (m *memoryRepo) plugin(v testRelease) MarketPlugin {
	pkg := v.packageData
	p := MarketPlugin{ID: pkg.ID, Name: pkg.Name, Description: pkg.Description, Author: pkg.Author, Version: pkg.Version,
		PublisherID: m.accounts[v.owner].PublisherID, Official: m.accounts[v.owner].Official, MinHostVersion: pkg.MinHostVersion, Platforms: pkg.Platforms,
		Manifest: append([]byte(nil), pkg.Manifest...), UpdatedAt: v.submission.UpdatedAt, DownloadCount: m.downloads[pkg.ID],
		Artifact: &Artifact{SHA256: pkg.SHA256, SizeBytes: pkg.SizeBytes, Platform: "any", Version: pkg.Version}}
	for key, r := range m.ratings {
		if r.PluginID == pkg.ID && !m.hidden[key] {
			p.RatingCount++
			p.RatingAverage += float64(r.Stars)
		}
	}
	if p.RatingCount > 0 {
		p.RatingAverage /= float64(p.RatingCount)
	}
	return p
}

func (m *memoryRepo) Catalog(ctx context.Context, q CatalogQuery) (CatalogPage, error) {
	if err := validateCatalogQuery(q); err != nil {
		return CatalogPage{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	latest := map[string]MarketPlugin{}
	for _, v := range m.releases {
		if v.submission.State != "published" {
			continue
		}
		p := m.plugin(v)
		if q.Query != "" && !strings.Contains(strings.ToLower(p.ID+" "+p.Name+" "+p.Description), strings.ToLower(q.Query)) {
			continue
		}
		if q.HostVersion != "" && p.MinHostVersion != "" && semver.Compare("v"+p.MinHostVersion, "v"+q.HostVersion) > 0 {
			continue
		}
		compatible := q.Platform == ""
		for _, platform := range p.Platforms {
			if platform == "any" || platform == q.Platform {
				compatible = true
			}
		}
		if !compatible {
			continue
		}
		if old, ok := latest[p.ID]; !ok || old.UpdatedAt.Before(p.UpdatedAt) {
			latest[p.ID] = p
		}
	}
	items := make([]MarketPlugin, 0, len(latest))
	for _, p := range latest {
		items = append(items, p)
	}
	mean, total := 3.0, 0
	sum := 0.0
	for key, r := range m.ratings {
		if !m.hidden[key] && m.published(r.PluginID) {
			sum += float64(r.Stars)
			total++
		}
	}
	if total > 0 {
		mean = sum / float64(total)
	}
	sort.Slice(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if a.Official != b.Official {
			return a.Official
		}
		if q.Sort == "downloads" && a.DownloadCount != b.DownloadCount {
			return a.DownloadCount > b.DownloadCount
		}
		if q.Sort == "rating" {
			scoreA := (a.RatingAverage*float64(a.RatingCount) + 10*mean) / (float64(a.RatingCount) + 10)
			scoreB := (b.RatingAverage*float64(b.RatingCount) + 10*mean) / (float64(b.RatingCount) + 10)
			if scoreA != scoreB {
				return scoreA > scoreB
			}
		}
		if !a.UpdatedAt.Equal(b.UpdatedAt) {
			return a.UpdatedAt.After(b.UpdatedAt)
		}
		return a.ID < b.ID
	})
	page := CatalogPage{Items: []MarketPlugin{}}
	if q.Offset >= len(items) {
		return page, nil
	}
	end := q.Offset + q.Limit
	if end < len(items) {
		if end <= 10000 {
			page.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(end)))
		}
	} else {
		end = len(items)
	}
	page.Items = items[q.Offset:end]
	return page, nil
}

func (m *memoryRepo) Plugin(ctx context.Context, id string) (MarketPlugin, error) {
	versions, err := m.Versions(ctx, id)
	if err != nil {
		return MarketPlugin{}, err
	}
	return versions[0], nil
}

func (m *memoryRepo) Versions(ctx context.Context, id string) ([]MarketPlugin, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	items := []MarketPlugin{}
	for _, v := range m.releases {
		if v.submission.PluginID == id && v.submission.State == "published" {
			items = append(items, m.plugin(v))
		}
	}
	if len(items) == 0 {
		return nil, ErrNotFound
	}
	sort.Slice(items, func(i, j int) bool { return items[i].UpdatedAt.After(items[j].UpdatedAt) })
	return items, nil
}

func (m *memoryRepo) Artifact(ctx context.Context, id, version, platform string) (Artifact, error) {
	versions, err := m.Versions(ctx, id)
	if err != nil {
		return Artifact{}, err
	}
	for _, v := range versions {
		if v.Version == version {
			for _, supported := range v.Platforms {
				if platform == "" || supported == "any" || supported == platform {
					return *v.Artifact, nil
				}
			}
		}
	}
	return Artifact{}, ErrNotFound
}

func (m *memoryRepo) PublishedArtifact(ctx context.Context, digest string) (Artifact, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, v := range m.releases {
		if v.submission.State == "published" && v.packageData.SHA256 == digest {
			return *m.plugin(v).Artifact, nil
		}
	}
	return Artifact{}, ErrNotFound
}

func (m *memoryRepo) CountDownload(ctx context.Context, digest string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, v := range m.releases {
		if v.submission.State == "published" && v.packageData.SHA256 == digest {
			m.downloads[v.submission.PluginID]++
			return nil
		}
	}
	return ErrNotFound
}

func (m *memoryRepo) Ratings(ctx context.Context, id string) ([]Rating, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.published(id) {
		return nil, ErrNotFound
	}
	result := []Rating{}
	for key, r := range m.ratings {
		if r.PluginID == id && !m.hidden[key] {
			result = append(result, r)
		}
	}
	return result, nil
}

func (m *memoryRepo) PutRating(ctx context.Context, a Account, r Rating) (Rating, error) {
	if err := validateRating(r); err != nil {
		return Rating{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	found := false
	for _, v := range m.releases {
		if v.submission.PluginID == r.PluginID && v.submission.State == "published" {
			if v.owner == a.ID {
				return Rating{}, ErrForbidden
			}
			if r.Version == "" || v.submission.Version == r.Version {
				r.Version = v.submission.Version
				found = true
			}
		}
	}
	if !found {
		return Rating{}, ErrNotFound
	}
	r.UserID = a.ID
	r.UpdatedAt = time.Now().UTC()
	m.ratings[a.ID+"/"+r.PluginID] = r
	return r, nil
}

func (m *memoryRepo) DeleteRating(ctx context.Context, a Account, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.published(id) {
		return ErrNotFound
	}
	delete(m.ratings, a.ID+"/"+id)
	return nil
}

func (m *memoryRepo) HideRating(ctx context.Context, a Account, id, user, reason string) error {
	if a.Role != "admin" {
		return ErrForbidden
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	key := user + "/" + id
	if _, ok := m.ratings[key]; !ok {
		return ErrNotFound
	}
	m.hidden[key] = true
	return nil
}

func (m *memoryRepo) Report(ctx context.Context, a Account, r Report) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.published(r.PluginID) {
		return ErrNotFound
	}
	if strings.TrimSpace(r.Reason) == "" || len(r.Reason) > 4000 {
		return ErrInvalid
	}
	return nil
}
