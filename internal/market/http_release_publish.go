package market

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"strings"
)

// ReleaseInspection is a read-only preflight of one exact GitHub Release.
// It is intentionally shaped like PackageInspection so the publish UI can
// reuse the same package identity, permission and digest review.
type ReleaseInspection struct {
	PackageInspection
	SourceURL  string `json:"sourceUrl"`
	ReleaseURL string `json:"releaseUrl"`
	ReleaseTag string `json:"releaseTag"`
	AssetName  string `json:"assetName"`
	Prerelease bool   `json:"prerelease"`
}

type releaseRequest struct {
	SourceURL string `json:"sourceUrl"`
}

type releasePublishRequest struct {
	SourceURL      string `json:"sourceUrl"`
	ExpectedDigest string `json:"expectedDigest"`
}

type inspectedRelease struct {
	source        ReleaseSource
	repositoryURL string
	archive       []byte
	packageInfo   ValidatedPackage
}

const officialPluginMonorepo = "Syngnat/GoNavi-Plugin-Market"

func (s *Server) releaseFetcher() (ExactReleaseFetcher, error) {
	fetcher, ok := s.releases.(ExactReleaseFetcher)
	if !ok || fetcher == nil {
		return nil, ErrInvalid
	}
	return fetcher, nil
}

func (s *Server) readRelease(ctx context.Context, sourceURL string) (inspectedRelease, error) {
	fetcher, err := s.releaseFetcher()
	if err != nil {
		return inspectedRelease{}, err
	}
	ref, err := parseReleaseReference(sourceURL)
	if err != nil {
		return inspectedRelease{}, err
	}
	if ref.Tag == "" && strings.EqualFold(ref.Owner+"/"+ref.Repo, officialPluginMonorepo) {
		return inspectedRelease{}, ErrReleaseRequired
	}
	release, err := fetcher.Release(ctx, ref)
	if err != nil {
		return inspectedRelease{}, err
	}
	archive, err := fetcher.FetchAsset(ctx, release.AssetURL)
	if err != nil || len(archive) == 0 || int64(len(archive)) > MaxArtifactBytes {
		return inspectedRelease{}, ErrInvalid
	}
	packageInfo, err := s.validateReleaseArchive(ctx, archive, release.AssetName)
	if err != nil {
		return inspectedRelease{}, ErrInvalid
	}
	return inspectedRelease{source: release, repositoryURL: ref.RepositoryURL(), archive: archive, packageInfo: packageInfo}, nil
}

func (s *Server) releaseInspection(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(w, r)
	if !ok {
		return
	}
	select {
	case s.uploadSlots <- struct{}{}:
		defer func() { <-s.uploadSlots }()
	default:
		writeAPIError(w, http.StatusServiceUnavailable, "upload_busy")
		return
	}
	var body releaseRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, err)
		return
	}
	release, err := s.readRelease(r.Context(), body.SourceURL)
	if err != nil {
		if errors.Is(err, ErrInvalid) {
			writeAPIError(w, http.StatusBadRequest, "artifact_invalid")
			return
		}
		writeError(w, err)
		return
	}
	p := release.packageInfo
	report := ReleaseInspection{
		PackageInspection: PackageInspection{
			CanPublish: true, PluginID: p.ID, Version: p.Version, Name: p.Name,
			Description: p.Description, Category: categoryFromManifest(p.Manifest),
			SizeBytes: p.SizeBytes, MinHostVersion: p.MinHostVersion, Platforms: p.Platforms,
			SHA256: p.SHA256, Manifest: p.Manifest,
		},
		SourceURL: release.repositoryURL, ReleaseURL: release.source.ReleaseURL,
		ReleaseTag: release.source.Tag, AssetName: release.source.AssetName, Prerelease: release.source.Prerelease,
	}
	if report.Platforms == nil {
		report.Platforms = []string{}
	}
	if !(a.Role == "publisher" || a.Role == "admin") || a.PublisherID == "" || !strings.HasPrefix(p.ID, a.PublisherID+".") {
		report.CanPublish = false
		report.Reason = "forbidden"
	}
	writeJSON(w, http.StatusOK, report)
}

// publishRelease performs a fresh read and digest comparison at commit time.
// It reuses the ordinary submission state machine and self-publication path.
func (s *Server) publishRelease(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(w, r)
	if !ok {
		return
	}
	if a.Role != "publisher" && a.Role != "admin" {
		writeError(w, ErrForbidden)
		return
	}
	var body releasePublishRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, err)
		return
	}
	if !validDigest(body.ExpectedDigest) {
		writeError(w, ErrInvalid)
		return
	}
	select {
	case s.uploadSlots <- struct{}{}:
		defer func() { <-s.uploadSlots }()
	default:
		writeAPIError(w, http.StatusServiceUnavailable, "upload_busy")
		return
	}
	release, err := s.readRelease(r.Context(), body.SourceURL)
	if err != nil {
		if errors.Is(err, ErrInvalid) {
			writeAPIError(w, http.StatusBadRequest, "artifact_invalid")
			return
		}
		writeError(w, err)
		return
	}
	if release.packageInfo.SHA256 != body.ExpectedDigest {
		writeAPIError(w, http.StatusConflict, "inspection_changed")
		return
	}
	p := release.packageInfo
	// An explicit monorepo Release is a one-off upload, not a safe repository
	// root for the background latest-Release worker.
	registerSource := !strings.EqualFold(release.source.Owner+"/"+release.source.Repo, officialPluginMonorepo)
	if !s.acquireArtifactSlot(w) {
		return
	}
	defer func() { <-s.artifactSlots }()
	if !strings.HasPrefix(p.ID, a.PublisherID+".") {
		writeError(w, ErrForbidden)
		return
	}
	submission, err := s.repo.BeginSubmission(r.Context(), a, p.ID, p.Version)
	if err != nil {
		writeError(w, err)
		return
	}
	for _, state := range []string{"submitted", "validating"} {
		if submission, err = s.repo.AdvanceSubmission(r.Context(), a, submission.ID, state, ""); err != nil {
			writeError(w, err)
			return
		}
	}
	if err = s.artifacts.Put(r.Context(), p.SHA256, bytes.NewReader(release.archive), p.SizeBytes); err != nil {
		s.failValidation(r, a, submission.ID, "artifact_storage_failed")
		writeError(w, err)
		return
	}
	if _, err = s.repo.ValidateSubmission(r.Context(), a, submission.ID, p); err != nil {
		writeError(w, err)
		return
	}
	if submission, err = s.repo.SelfPublish(r.Context(), a, submission.ID); err != nil {
		writeError(w, err)
		return
	}
	if registerSource {
		err = s.repo.SetPluginSource(r.Context(), a, p.ID, release.repositoryURL)
	}
	if err != nil {
		// The release is already live. Keep the result useful and direct the
		// author to the account page to restore auto-sync.
		submission.Warning = "source_update_failed"
	}
	writeJSON(w, http.StatusCreated, submission)
}
