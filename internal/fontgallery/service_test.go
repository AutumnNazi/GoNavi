package fontgallery

import (
	"net/http"
	"testing"
)

func TestNewServiceOfflineStatus(t *testing.T) {
	s, err := NewService(Options{Root: t.TempDir(), Client: &http.Client{Transport: rejectTransport{t}}})
	if err != nil {
		t.Fatal(err)
	}
	state, err := s.Status()
	if err != nil {
		t.Fatal(err)
	}
	if state.Catalog != nil || state.Installed == nil || len(state.Installed) != 0 {
		t.Fatalf("unexpected state: %+v", state)
	}
}

type rejectTransport struct{ t *testing.T }

func (r rejectTransport) RoundTrip(*http.Request) (*http.Response, error) {
	r.t.Fatal("unexpected network request")
	return nil, nil
}
