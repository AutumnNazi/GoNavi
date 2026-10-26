package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func TestCancellationReachesUpstream(t *testing.T) {
	connected := make(chan struct{})
	disconnected := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		drainRequest(t, r)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		close(connected)
		<-r.Context().Done()
		close(disconnected)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// One generation owns one terminal result; the test always joins it.
	finished := make(chan error, 1)
	provider := testHTTPProvider(t)
	go func() {
		_, err := provider.generate(ctx, testStart(server.URL), nil)
		finished <- err
	}()
	select {
	case <-connected:
	case <-ctx.Done():
		t.Fatal("upstream connection was not established")
	}
	cancel()
	select {
	case err := <-finished:
		assertFailure(t, err, "generation_failed")
	case <-time.After(time.Second):
		t.Fatal("generation did not observe cancellation")
	}
	select {
	case <-disconnected:
	case <-time.After(time.Second):
		t.Fatal("HTTP server context did not observe cancellation")
	}
}

func TestStalledResponseHasNoRetry(t *testing.T) {
	for _, headersSent := range []bool{false, true} {
		name := "response headers"
		if headersSent {
			name = "response body"
		}
		t.Run(name, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				drainRequest(t, r)
				requests.Add(1)
				if headersSent {
					w.Header().Set("Content-Type", "text/event-stream")
					w.(http.Flusher).Flush()
				}
				<-r.Context().Done()
			}))
			defer server.Close()
			provider := testHTTPProvider(t)
			provider.client.Transport.(*http.Transport).ResponseHeaderTimeout = 50 * time.Millisecond
			ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
			defer cancel()
			_, err := provider.generate(ctx, testStart(server.URL), nil)
			assertFailure(t, err, "generation_failed")
			if requests.Load() != 1 {
				t.Fatalf("upstream was contacted %d times", requests.Load())
			}
		})
	}
}

func TestEmitFailureStopsReadingAndClosesHTTPBody(t *testing.T) {
	disconnected := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		drainRequest(t, r)
		w.Header().Set("Content-Type", "text/event-stream")
		if _, err := io.WriteString(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"one\"}}]}\n\n"); err != nil {
			t.Error(err)
			return
		}
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(disconnected)
	}))
	defer server.Close()
	count := 0
	_, err := testHTTPProvider(t).generate(testContext(t), testStart(server.URL), func(_ plugin.AIProviderDelta) error {
		count++
		return failure("canceled")
	})
	assertFailure(t, err, "canceled")
	if count != 1 {
		t.Fatal("emission continued after failure")
	}
	select {
	case <-disconnected:
	case <-time.After(time.Second):
		t.Fatal("failed emitter did not stop HTTP reading")
	}
}

func TestTransportFailureDoesNotDiscloseSelectedURL(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	base := server.URL + "/SECRET-path?token=SECRET-token"
	server.Close()
	_, err := testHTTPProvider(t).generate(testContext(t), testStart(base), nil)
	assertFailure(t, err, "generation_failed")
}
