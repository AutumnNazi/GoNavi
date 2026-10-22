package pluginmarket

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"
)

type fakeSecrets struct {
	mu        sync.Mutex
	values    map[string][]byte
	putErr    error
	getErr    error
	deleteErr error
}

func newFakeSecrets() *fakeSecrets { return &fakeSecrets{values: make(map[string][]byte)} }
func (f *fakeSecrets) Put(ref string, payload []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.putErr != nil {
		return f.putErr
	}
	f.values[ref] = append([]byte(nil), payload...)
	return nil
}
func (f *fakeSecrets) Get(ref string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.getErr != nil {
		return nil, f.getErr
	}
	payload, exists := f.values[ref]
	if !exists {
		return nil, os.ErrNotExist
	}
	return append([]byte(nil), payload...), nil
}
func (f *fakeSecrets) Delete(ref string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.deleteErr != nil {
		return f.deleteErr
	}
	if _, exists := f.values[ref]; !exists {
		return os.ErrNotExist
	}
	delete(f.values, ref)
	return nil
}
func (f *fakeSecrets) HealthCheck() error { return nil }

func newTestService(t *testing.T, base string, trusted bool) (*Service, *fakeSecrets) {
	t.Helper()
	secrets := newFakeSecrets()
	options := Options{Root: t.TempDir(), Secrets: secrets, HostVersion: "1.2.3"}
	if trusted {
		options.TrustedOfficialURL = base
	}
	service, err := NewService(options)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Configure(t.Context(), base); err != nil {
		t.Fatal(err)
	}
	return service, secrets
}

func writeTestJSON(t *testing.T, w http.ResponseWriter, status int, value any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		t.Errorf("write response: %v", err)
	}
}

func fixtureItem(id string, official bool) Item {
	return Item{ID: id, Name: id, Version: "1.0.0", Official: official, PublisherID: "publisher",
		Platforms: []string{"any"}, RatingAverage: 4.5, RatingCount: 2, UpdatedAt: time.Now().UTC()}
}

func seedToken(t *testing.T, service *Service, value string) {
	t.Helper()
	source, err := service.snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if err = service.saveToken(source.id, storedToken{AccessToken: value, ExpiresAt: service.now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
}

func assertErrorIs(t *testing.T, err, target error) {
	t.Helper()
	if !errors.Is(err, target) {
		t.Fatalf("error = %v, want %v", err, target)
	}
}
