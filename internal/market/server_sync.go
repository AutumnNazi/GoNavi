package market

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
)

// SyncOutcome reports what one tracked plugin's sync pass did.
type SyncOutcome struct {
	PluginID  string `json:"pluginId"`
	Version   string `json:"version,omitempty"`
	Skipped   bool   `json:"skipped"`
	Published bool   `json:"published"`
	Reason    string `json:"reason,omitempty"`
}

// setReleaseFetcher swaps the release source after construction; tests use it
// to inject stubs into the standard HTTP fixture.
func (s *Server) setReleaseFetcher(fetcher ReleaseFetcher) error {
	if fetcher == nil {
		return ErrInvalid
	}
	s.releases = fetcher
	return nil
}

// syncRelease pulls one tracked plugin's latest release through validation
// and the ordinary publication pipeline.
func (s *Server) syncRelease(ctx context.Context, plugin SourcePlugin) (SyncOutcome, error) {
	owner, repo, err := parseRepositoryURL(plugin.SourceURL)
	if err != nil {
		return SyncOutcome{PluginID: plugin.PluginID, Skipped: true, Reason: "invalid source url"}, err
	}
	release, err := s.releases.LatestRelease(ctx, owner, repo)
	if err != nil {
		return SyncOutcome{PluginID: plugin.PluginID, Skipped: true, Reason: "release unavailable"}, err
	}
	archive, err := s.releases.FetchAsset(ctx, release.AssetURL)
	if err != nil || len(archive) == 0 || int64(len(archive)) > MaxArtifactBytes {
		return SyncOutcome{PluginID: plugin.PluginID, Skipped: true, Reason: "asset unavailable"}, err
	}
	validated, err := s.validateReleaseArchive(ctx, archive, release.AssetName)
	if err != nil {
		return SyncOutcome{PluginID: plugin.PluginID, Skipped: true, Reason: "artifact_invalid"}, err
	}
	if validated.ID != plugin.PluginID {
		return SyncOutcome{PluginID: plugin.PluginID, Skipped: true, Reason: "release manifest belongs to another plugin"}, ErrConflict
	}
	outcome := SyncOutcome{PluginID: plugin.PluginID, Version: validated.Version}
	if plugin.PublishedVersion != "" && !versionNewer(validated.Version, plugin.PublishedVersion) {
		outcome.Skipped = true
		outcome.Reason = "release is not newer than the published version"
		return outcome, nil
	}
	if err = s.artifacts.Put(ctx, validated.SHA256, bytes.NewReader(archive), validated.SizeBytes); err != nil {
		return outcome, err
	}
	// The release pipeline runs as the plugin owner so namespace ownership,
	// state-machine invariants and audit history stay exactly as a manual upload.
	submission, err := s.repo.BeginSubmission(ctx, plugin.Owner, validated.ID, validated.Version)
	if err != nil {
		if errors.Is(err, ErrConflict) {
			outcome.Skipped = true
			outcome.Reason = "version already submitted"
			return outcome, nil
		}
		return outcome, err
	}
	for _, state := range []string{"submitted", "validating"} {
		if submission, err = s.repo.AdvanceSubmission(ctx, plugin.Owner, submission.ID, state, ""); err != nil {
			return outcome, err
		}
	}
	if _, err = s.repo.ValidateSubmission(ctx, plugin.Owner, submission.ID, validated); err != nil {
		return outcome, err
	}
	if _, err = s.repo.SelfPublish(ctx, plugin.Owner, submission.ID); err != nil {
		return outcome, err
	}
	outcome.Published = true
	return outcome, nil
}

// validateReleaseArchive stages fetched bytes so ValidatePackage can inspect
// the archive exactly like an uploaded one, then removes the staging file.
func (s *Server) validateReleaseArchive(ctx context.Context, archive []byte, name string) (ValidatedPackage, error) {
	if name == "" {
		name = "release.zip"
	}
	staged, err := os.CreateTemp("", "gonavi-market-sync-*-"+filepath.Base(name))
	if err != nil {
		return ValidatedPackage{}, fmt.Errorf("stage release archive failed")
	}
	path := staged.Name()
	defer os.Remove(path)
	if _, err = staged.Write(archive); err != nil {
		staged.Close()
		return ValidatedPackage{}, fmt.Errorf("stage release archive failed")
	}
	if err = staged.Close(); err != nil {
		return ValidatedPackage{}, fmt.Errorf("stage release archive failed")
	}
	return ValidatePackage(ctx, path)
}

// SyncAllReleases runs one pass over every tracked plugin. Single-plugin
// failures never abort the pass; each outcome reports what happened.
func (s *Server) SyncAllReleases(ctx context.Context) ([]SyncOutcome, error) {
	if s.releases == nil {
		return nil, ErrInvalid
	}
	plugins, err := s.repo.SourcePlugins(ctx)
	if err != nil {
		return nil, err
	}
	outcomes := make([]SyncOutcome, 0, len(plugins))
	for _, plugin := range plugins {
		outcome, syncErr := s.syncRelease(ctx, plugin)
		if syncErr != nil && outcome.Reason == "" {
			outcome.Reason = "sync failed"
		}
		outcomes = append(outcomes, outcome)
	}
	return outcomes, ctx.Err()
}

// syncReleases lets an administrator run one sync pass on demand instead of
// waiting for the background interval.
func (s *Server) syncReleases(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.admin(w, r); !ok {
		return
	}
	outcomes, err := s.SyncAllReleases(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	if outcomes == nil {
		outcomes = []SyncOutcome{}
	}
	writeJSON(w, 200, outcomes)
}
