package syncworker

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"testing"
	"time"
)

func TestWorkerSingleInstanceHealthAndStop(t *testing.T) {
	root := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1) // One owned worker completion.
	closed := make(chan struct{})
	go func() {
		done <- Run(ctx, root, func(context.Context) (func(), error) { return func() { close(closed) }, nil })
	}()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for !healthy(ctx, root) {
		select {
		case <-ctx.Done():
			t.Fatal("worker did not become ready")
		case <-ticker.C:
		}
	}
	if err := Run(ctx, root, func(context.Context) (func(), error) { t.Error("second worker started"); return func() {}, nil }); err != nil {
		t.Fatal(err)
	}
	payload, err := os.ReadFile(statePath(root))
	if err != nil {
		t.Fatal(err)
	}
	var current state
	if err := json.Unmarshal(payload, &current); err != nil {
		t.Fatal(err)
	}
	response, err := http.Post("http://"+current.Address+"/stop", "text/plain", nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("unauthenticated stop: %d", response.StatusCode)
	}
	if err := Stop(ctx, root); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	select {
	case <-closed:
	default:
		t.Fatal("stop did not drain runtime")
	}
	if _, err := os.Stat(statePath(root)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale worker state: %v", err)
	}
	lock, err := acquire(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := lock.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestWorkerInitializationFailureReleasesLock(t *testing.T) {
	root := t.TempDir()
	cause := errors.New("initialization failed")
	err := Run(context.Background(), root, func(context.Context) (func(), error) { return nil, cause })
	if !errors.Is(err, cause) {
		t.Fatal(err)
	}
	lock, err := acquire(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := lock.Close(); err != nil {
		t.Fatal(err)
	}
}
