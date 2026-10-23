package main

import (
	"context"
	"testing"
)

func TestRunRequiresExplicitDatabase(t *testing.T) {
	t.Setenv("GONAVI_MARKET_DATABASE_URL", "")
	if err := run(context.Background(), commandOptions{}); err == nil {
		t.Fatal("server started without durable database")
	}
}

func TestConfiguredIdentityFailsClosed(t *testing.T) {
	for _, test := range []struct {
		name, id, secret        string
		wantProvider, wantError bool
	}{
		{name: "disabled"},
		{name: "missing secret", id: "client", wantError: true},
		{name: "missing id", secret: "test-secret", wantError: true},
		{name: "configured", id: "client", secret: "test-secret", wantProvider: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("GONAVI_MARKET_GITHUB_CLIENT_ID", test.id)
			t.Setenv("GONAVI_MARKET_GITHUB_CLIENT_SECRET", test.secret)
			provider, err := configuredIdentity("http://localhost:8090")
			if (err != nil) != test.wantError {
				t.Fatalf("err=%v", err)
			}
			if err == nil && (provider != nil) != test.wantProvider {
				t.Fatal("provider availability mismatch")
			}
		})
	}
}

func TestConfiguredArtifactsRequiresRealStore(t *testing.T) {
	t.Setenv("GONAVI_MARKET_ARTIFACT_STORE", "filesystem")
	t.Setenv("GONAVI_MARKET_ARTIFACT_ROOT", "")
	if _, err := configuredArtifacts(); err == nil {
		t.Fatal("missing artifact root accepted")
	}
	t.Setenv("GONAVI_MARKET_ARTIFACT_ROOT", t.TempDir())
	if _, err := configuredArtifacts(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GONAVI_MARKET_ARTIFACT_STORE", "unsupported")
	if _, err := configuredArtifacts(); err == nil {
		t.Fatal("unsupported artifact storage accepted")
	}
}
