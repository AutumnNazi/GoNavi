package app

import (
	"fmt"
	"os"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/secretstore"
)

func TestSplitConnectionSecretsStripsPasswordsAndOpaqueDSN(t *testing.T) {
	withTestGOOS(t, "linux")

	input := connection.SavedConnectionInput{
		ID:   "conn-1",
		Name: "Primary",
		Config: connection.ConnectionConfig{
			ID:       "conn-1",
			Type:     "postgres",
			Host:     "db.local",
			Password: "postgres-secret",
			DSN:      "postgres://user:pass@db.local/app",
		},
	}

	view, bundle := splitConnectionSecrets(input)
	if view.Config.Password != "" {
		t.Fatal("metadata must not keep password")
	}
	if bundle.Password != "postgres-secret" {
		t.Fatal("bundle should keep primary password")
	}
	if bundle.OpaqueDSN == "" {
		t.Fatal("opaque DSN should be stored as secret")
	}
	if !view.HasPrimaryPassword {
		t.Fatal("expected view to report primary password")
	}
	if !view.HasOpaqueDSN {
		t.Fatal("expected view to report opaque DSN")
	}
}

func TestSavedConnectionRepositoryDefaultsLegacyEnvironmentToLocal(t *testing.T) {
	repo := newSavedConnectionRepository(t.TempDir(), newFakeAppSecretStore())
	if err := repo.saveAll([]connection.SavedConnectionView{
		{
			ID:   "legacy-connection",
			Name: "Legacy",
			Config: connection.ConnectionConfig{
				ID:   "legacy-connection",
				Type: "sqlite",
			},
		},
	}); err != nil {
		t.Fatal(err)
	}

	items, err := repo.load()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].EnvironmentType != defaultConnectionEnvironment {
		t.Fatalf("expected legacy environment to default to %q, got %#v", defaultConnectionEnvironment, items)
	}
}

func TestSplitConnectionSecretsStripsRedisSentinelPassword(t *testing.T) {
	withTestGOOS(t, "linux")

	input := connection.SavedConnectionInput{
		ID:   "redis-sentinel",
		Name: "Redis Sentinel",
		Config: connection.ConnectionConfig{
			ID:                    "redis-sentinel",
			Type:                  "redis",
			Host:                  "sentinel.local",
			Port:                  26379,
			Topology:              "sentinel",
			RedisSentinelMaster:   "mymaster",
			RedisSentinelUser:     "sentinel-user",
			RedisSentinelPassword: "sentinel-secret",
		},
	}

	view, bundle := splitConnectionSecrets(input)
	if view.Config.RedisSentinelPassword != "" {
		t.Fatal("metadata must not keep Redis Sentinel password")
	}
	if bundle.RedisSentinelPassword != "sentinel-secret" {
		t.Fatalf("bundle should keep Redis Sentinel password, got %q", bundle.RedisSentinelPassword)
	}
	if !view.HasRedisSentinelPassword {
		t.Fatal("expected view to report Redis Sentinel password")
	}
}

type fakeAppSecretStore struct {
	items map[string][]byte
}

func newFakeAppSecretStore() *fakeAppSecretStore {
	return &fakeAppSecretStore{items: make(map[string][]byte)}
}

func (s *fakeAppSecretStore) Put(ref string, payload []byte) error {
	s.items[ref] = append([]byte(nil), payload...)
	return nil
}

func (s *fakeAppSecretStore) Get(ref string) ([]byte, error) {
	payload, ok := s.items[ref]
	if !ok {
		return nil, os.ErrNotExist
	}
	return append([]byte(nil), payload...), nil
}

func (s *fakeAppSecretStore) Delete(ref string) error {
	delete(s.items, ref)
	return nil
}

func (s *fakeAppSecretStore) HealthCheck() error {
	return nil
}

var _ secretstore.SecretStore = (*fakeAppSecretStore)(nil)

type failOnUseSecretStore struct{}

func (s failOnUseSecretStore) Put(string, []byte) error {
	return fmt.Errorf("secret store should not be used")
}

func (s failOnUseSecretStore) Get(string) ([]byte, error) {
	return nil, fmt.Errorf("secret store should not be used")
}

func (s failOnUseSecretStore) Delete(string) error {
	return fmt.Errorf("secret store should not be used")
}

func (s failOnUseSecretStore) HealthCheck() error {
	return fmt.Errorf("secret store should not be used")
}

var _ secretstore.SecretStore = (*failOnUseSecretStore)(nil)
