// Command gonavi-market-server serves the shared marketplace, never plugin code.
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/market"
)

type commandOptions struct {
	migrate                       bool
	grantID, grantRole, publisher string
	official                      bool
}

func main() {
	options := commandOptions{}
	flag.BoolVar(&options.migrate, "migrate", false, "apply PostgreSQL migrations and exit")
	flag.StringVar(&options.grantID, "grant-github-id", "", "explicitly grant a role to this immutable GitHub numeric ID, then exit")
	flag.StringVar(&options.grantRole, "grant-role", "user", "operator-assigned user, publisher or admin role")
	flag.StringVar(&options.publisher, "publisher", "", "unique publisher namespace for an operator role grant")
	flag.BoolVar(&options.official, "official", false, "mark the explicitly granted publisher official")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, options); err != nil {
		// Never log the underlying database/transport error: it may contain credentials.
		logger.Errorf("market server stopped with an error; verify configuration and database availability")
		logger.Close()
		os.Exit(1)
	}
	logger.Close()
}

func run(ctx context.Context, options commandOptions) error {
	dsn := os.Getenv("GONAVI_MARKET_DATABASE_URL")
	if dsn == "" {
		return errors.New("market database configuration required")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return errors.New("market database configuration invalid")
	}
	defer db.Close()
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	err = db.PingContext(pingCtx)
	cancel()
	if err != nil {
		return errors.New("market database unavailable")
	}
	repository := market.NewPostgres(db)
	if options.migrate {
		return repository.Migrate(ctx)
	}
	if options.grantID != "" {
		return repository.GrantRole(ctx, options.grantID, options.publisher, options.grantRole, options.official)
	}
	return serve(ctx, repository)
}

func serve(ctx context.Context, repository *market.Postgres) error {
	publicURL := strings.TrimRight(os.Getenv("GONAVI_MARKET_PUBLIC_URL"), "/")
	if publicURL == "" {
		return errors.New("market public URL required")
	}
	store, err := configuredArtifacts()
	if err != nil {
		return err
	}
	provider, err := configuredIdentity(publicURL)
	if err != nil {
		return err
	}
	api, err := market.NewServer(market.ServerOptions{Repository: repository, Artifacts: store, Identity: provider, PublicURL: publicURL})
	if err != nil {
		return err
	}
	address := os.Getenv("GONAVI_MARKET_LISTEN")
	if address == "" {
		address = "127.0.0.1:8090"
	}
	server := &http.Server{Addr: address, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 90 * time.Second,
		WriteTimeout: 2 * time.Minute, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	result := make(chan error, 1) // One server result; shutdown must not block the serving goroutine.
	go func() { result <- server.ListenAndServe() }()
	select {
	case err = <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err = server.Shutdown(shutdownCtx); err != nil {
			if closeErr := server.Close(); closeErr != nil {
				logger.Warnf("market listener close failed")
			}
		}
		serveErr := <-result
		if err != nil {
			return err
		}
		if !errors.Is(serveErr, http.ErrServerClosed) {
			return serveErr
		}
		return nil
	}
}

func configuredIdentity(publicURL string) (market.IdentityProvider, error) {
	id := os.Getenv("GONAVI_MARKET_GITHUB_CLIENT_ID")
	secret := os.Getenv("GONAVI_MARKET_GITHUB_CLIENT_SECRET")
	if id == "" && secret == "" {
		return nil, nil
	}
	return market.NewGitHubProvider(market.GitHubConfig{ClientID: id, ClientSecret: secret, CallbackURL: publicURL + "/api/v1/auth/github/callback"})
}

func configuredArtifacts() (market.ArtifactStore, error) {
	kind := os.Getenv("GONAVI_MARKET_ARTIFACT_STORE")
	if kind == "s3" {
		return configuredS3()
	}
	if kind != "" && kind != "filesystem" {
		return nil, errors.New("artifact store is not configured by this build")
	}
	root := os.Getenv("GONAVI_MARKET_ARTIFACT_ROOT")
	if root == "" {
		return nil, errors.New("market artifact root required")
	}
	return market.NewFileStore(root)
}
