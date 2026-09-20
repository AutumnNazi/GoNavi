package app

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// newStallingDownloadServer answers range probes immediately and stalls every
// full download until the client disconnects, so tests can prove that a
// cancellation reaches the in-flight request instead of waiting for a timeout.
func newStallingDownloadServer(t *testing.T) (*httptest.Server, <-chan struct{}, <-chan struct{}) {
	t.Helper()
	downloading := make(chan struct{})
	released := make(chan struct{})
	var downloadOnce, releaseOnce sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("probe"))
			return
		}
		w.Header().Set("Content-Length", "1048576")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("partial-driver-agent"))
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		downloadOnce.Do(func() { close(downloading) })
		<-r.Context().Done()
		releaseOnce.Do(func() { close(released) })
	}))
	t.Cleanup(server.Close)
	return server, downloading, released
}

func TestContextBoundTransportCancelsStreamingBody(t *testing.T) {
	server, downloading, released := newStallingDownloadServer(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	client := &http.Client{Transport: newContextBoundTransport(ctx, http.DefaultTransport.(*http.Transport).Clone())}
	resp, err := client.Get(server.URL + "/agent")
	if err != nil {
		t.Fatalf("initial request failed: %v", err)
	}
	defer resp.Body.Close()
	select {
	case <-downloading:
	case <-time.After(3 * time.Second):
		t.Fatal("server did not start streaming")
	}

	readErr := make(chan error, 1)
	go func() {
		_, copyErr := io.Copy(io.Discard, resp.Body)
		readErr <- copyErr
	}()
	cancel()
	select {
	case copyErr := <-readErr:
		if !errors.Is(copyErr, context.Canceled) {
			t.Fatalf("body read error = %v, want context.Canceled", copyErr)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("body read did not observe cancellation")
	}
	select {
	case <-released:
	case <-time.After(3 * time.Second):
		t.Fatal("server did not observe the client disconnect")
	}
}

func TestContextBoundTransportRejectsRequestsAfterCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	transport := newContextBoundTransport(ctx, http.DefaultTransport)
	req, err := http.NewRequest(http.MethodGet, "http://127.0.0.1:9/never", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if _, err := transport.RoundTrip(req); !errors.Is(err, context.Canceled) {
		t.Fatalf("RoundTrip error = %v, want context.Canceled", err)
	}
}

func TestCloneTransportWithResponseHeaderTimeoutPreservesContextBinding(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bound := newContextBoundTransport(ctx, http.DefaultTransport.(*http.Transport).Clone())
	cloned, ok := cloneTransportWithResponseHeaderTimeout(bound, parallelDownloadHeaderTimeout).(*contextBoundTransport)
	if !ok {
		t.Fatalf("cloned transport = %T, want *contextBoundTransport", cloned)
	}
	if cloned == bound {
		t.Fatal("expected a distinct transport instance")
	}
	if cloned.ctx != ctx {
		t.Fatal("cloned transport lost its context binding")
	}
	base, ok := cloned.base.(*http.Transport)
	if !ok || base.ResponseHeaderTimeout != parallelDownloadHeaderTimeout {
		t.Fatalf("cloned base = %T header timeout mismatch", cloned.base)
	}
	if cloneTransportWithResponseHeaderTimeout(nil, parallelDownloadHeaderTimeout) != nil {
		t.Fatal("nil transport should not be cloned")
	}
}

func TestDownloadFileWithHashPreferredForAppContextStopsOnCancel(t *testing.T) {
	disableGlobalProxyForTest(t)
	server, downloading, released := newStallingDownloadServer(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := downloadFileWithHashPreferredForAppContext(ctx, nil, server.URL+"/agent.bin", filepath.Join(t.TempDir(), "agent.bin"), nil)
		result <- err
	}()
	select {
	case <-downloading:
	case <-time.After(5 * time.Second):
		t.Fatal("download did not reach the server")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("download error = %v, want context.Canceled", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("download did not stop after cancellation")
	}
	select {
	case <-released:
	case <-time.After(3 * time.Second):
		t.Fatal("server connection was not released after cancellation")
	}
}
