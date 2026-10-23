package pluginmarket

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

type countingSecrets struct {
	*fakeSecrets
	reads atomic.Int32
}

func (s *countingSecrets) Get(ref string) ([]byte, error) {
	s.reads.Add(1)
	return s.fakeSecrets.Get(ref)
}

type rejectingTransport struct{ requests atomic.Int32 }

func (r *rejectingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	r.requests.Add(1)
	return nil, errors.New("unexpected network request")
}

func TestCurrentSourceIDUsesOnlyLastCommittedState(t *testing.T) {
	secrets := &countingSecrets{fakeSecrets: newFakeSecrets()}
	transport := &rejectingTransport{}
	service, err := NewService(Options{Root: t.TempDir(), Secrets: secrets, Client: &http.Client{Transport: transport}})
	if err != nil {
		t.Fatal(err)
	}
	id, err := service.CurrentSourceID()
	assertErrorIs(t, err, ErrNotConfigured)
	if id != "" {
		t.Fatal("unconfigured service returned an identity")
	}
	settings, err := service.Configure(t.Context(), "https://First.Example:443/api/v1/")
	if err != nil {
		t.Fatal(err)
	}
	reads := secrets.reads.Load()
	id, err = service.CurrentSourceID()
	if err != nil || id != settings.SourceID || id != sourceID("https://first.example") {
		t.Fatalf("source = %q, %v", id, err)
	}
	settingsPath := filepath.Join(service.root, "settings.json")
	if err = os.Remove(settingsPath); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(settingsPath, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Configure(t.Context(), "https://second.example"); err == nil {
		t.Fatal("persistence fixture did not fail")
	}
	id, err = service.CurrentSourceID()
	if err != nil || id != settings.SourceID {
		t.Fatalf("failed configuration published source = %q, %v", id, err)
	}
	if secrets.reads.Load() != reads || transport.requests.Load() != 0 {
		t.Fatal("source lookup performed credential or network IO")
	}
	if err = os.Remove(settingsPath); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Configure(t.Context(), ""); err != nil {
		t.Fatal(err)
	}
	id, err = service.CurrentSourceID()
	assertErrorIs(t, err, ErrNotConfigured)
	if id != "" {
		t.Fatal("disabled marketplace retained selected source identity")
	}
}

func TestCurrentSourceIDLoadsPersistedAndTrustedDefaultSources(t *testing.T) {
	service, err := NewService(Options{Root: t.TempDir(), TrustedOfficialURL: "https://official.example/api/v1"})
	if err != nil {
		t.Fatal(err)
	}
	id, err := service.CurrentSourceID()
	if err != nil || id != sourceID("https://official.example") {
		t.Fatalf("default source = %q, %v", id, err)
	}
	if _, err = service.Configure(t.Context(), "https://private.example"); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewService(Options{Root: service.root, TrustedOfficialURL: "https://official.example"})
	if err != nil {
		t.Fatal(err)
	}
	id, err = restarted.CurrentSourceID()
	if err != nil || id != sourceID("https://private.example") {
		t.Fatalf("persisted source = %q, %v", id, err)
	}
}

func TestCurrentSourceIDDoesNotWaitForKeychainOrStatePersistenceLock(t *testing.T) {
	secrets := &blockingSecrets{fakeSecrets: newFakeSecrets(), entered: make(chan struct{}), release: make(chan struct{})}
	service, err := NewService(Options{Root: t.TempDir(), Secrets: secrets, TrustedOfficialURL: "https://first.example"})
	if err != nil {
		t.Fatal(err)
	}
	secrets.enabled.Store(true)
	// Each lookup sends exactly one completion, even when a timeout assertion has already fired.
	settingsDone := make(chan error, 1)
	go func() { _, err := service.Settings(); settingsDone <- err }()
	<-secrets.entered
	service.mu.Lock()
	type lookupResult struct {
		id  string
		err error
	}
	lookupDone := make(chan lookupResult, 1)
	go func() { id, err := service.CurrentSourceID(); lookupDone <- lookupResult{id: id, err: err} }()
	var outcome lookupResult
	completed := false
	select {
	case outcome = <-lookupDone:
		completed = true
	case <-time.After(time.Second):
		t.Error("source lookup waited on keychain or persistence mutex")
	}
	service.mu.Unlock()
	close(secrets.release)
	if !completed {
		outcome = <-lookupDone
	}
	if outcome.err != nil || outcome.id != sourceID("https://first.example") {
		t.Fatalf("source = %q, %v", outcome.id, outcome.err)
	}
	if err = <-settingsDone; err != nil {
		t.Fatal(err)
	}
}
