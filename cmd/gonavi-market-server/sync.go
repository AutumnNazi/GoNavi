package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"strconv"
	"time"

	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/market"
)

type releaseSyncer interface {
	SyncAllReleases(context.Context) ([]market.SyncOutcome, error)
}

func startReleaseSync(ctx context.Context, api releaseSyncer) func() {
	workerCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		runReleaseSync(workerCtx, api)
	}()
	return func() {
		cancel()
		<-done
	}
}

// runReleaseSync keeps tracked plugins current with their GitHub latest
// release. One pass runs shortly after startup, then after each interval.
func runReleaseSync(ctx context.Context, api releaseSyncer) {
	timer := time.NewTimer(time.Minute)
	defer timer.Stop()
	for {
		select {
		case <-timer.C:
			if ctx.Err() != nil {
				return
			}
			syncOnce(ctx, api)
			timer.Reset(releaseSyncInterval())
		case <-ctx.Done():
			return
		}
	}
}

func syncOnce(ctx context.Context, api releaseSyncer) {
	syncCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	outcomes, err := api.SyncAllReleases(syncCtx)
	if err != nil {
		logger.Warnf("market release sync pass failed")
		return
	}
	for _, outcome := range outcomes {
		if outcome.Published {
			logger.Infof("market release sync published %s %s", outcome.PluginID, outcome.Version)
		} else if outcome.Reason != "" && outcome.Reason != "release is not newer than the published version" {
			logger.Warnf("market release sync skipped %s: %s", outcome.PluginID, outcome.Reason)
		}
	}
}

// syncOnceFromCLI runs one release sync pass for operators without an admin
// token and prints each outcome as JSON.
func syncOnceFromCLI(ctx context.Context, db *sql.DB, options commandOptions) error {
	store, err := configuredArtifacts()
	if err != nil {
		return err
	}
	api, err := market.NewServer(market.ServerOptions{Repository: market.NewPostgres(db), Artifacts: store,
		Releases: market.NewGitHubReleaseFetcher(os.Getenv("GONAVI_MARKET_GITHUB_TOKEN")), PublicURL: os.Getenv("GONAVI_MARKET_PUBLIC_URL")})
	if err != nil {
		return err
	}
	outcomes, err := api.SyncAllReleases(ctx)
	encoded, encodeErr := json.Marshal(outcomes)
	if encodeErr != nil {
		return encodeErr
	}
	os.Stdout.Write(append(encoded, '\n'))
	return err
}

func releaseSyncInterval() time.Duration {
	if raw := os.Getenv("GONAVI_MARKET_SYNC_INTERVAL"); raw != "" {
		if seconds, err := strconv.Atoi(raw); err == nil && seconds >= 60 {
			return time.Duration(seconds) * time.Second
		}
	}
	return 6 * time.Hour
}
