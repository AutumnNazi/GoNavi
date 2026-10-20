package app

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/backgroundgallery"
)

type backgroundGalleryRequest struct {
	cancel context.CancelFunc
	done   chan struct{}
}

type backgroundGalleryState struct {
	operations sync.RWMutex
	paused     bool
	mu         sync.Mutex
	root       string
	service    *backgroundgallery.Service
	requests   map[string]*backgroundGalleryRequest
	canceled   map[string]time.Time
	closing    bool
}

// ConfigDirForIntegration returns the directory used for persisted application
// settings. It is a package function rather than an App method so Wails does
// not expose the local filesystem path through its reflective RPC bridge.
func ConfigDirForIntegration(a *App) string {
	if a == nil {
		return ""
	}
	return strings.TrimSpace(a.configDir)
}

func (a *App) backgroundGalleryService() (*backgroundgallery.Service, error) {
	if a == nil || a.webRuntime || ConfigDirForIntegration(a) == "" {
		return nil, errors.New("gallery runtime unavailable")
	}
	state := &a.backgroundGallery
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.closing || state.paused {
		return nil, context.Canceled
	}
	root := ConfigDirForIntegration(a)
	if state.service != nil && state.root == root {
		return state.service, nil
	}
	// A changed active data root must not leave a previous download alive.
	for _, request := range state.requests {
		request.cancel()
	}
	service, err := backgroundgallery.NewService(backgroundgallery.Options{Root: root, Client: &http.Client{Transport: backgroundGalleryProxyTransport{}}})
	if err != nil {
		return nil, err
	}
	state.root, state.service = root, service
	return service, nil
}

func galleryRequestIDValid(id string) bool {
	if id == "" || len(id) > 128 {
		return false
	}
	for _, r := range id {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

func (a *App) beginBackgroundGalleryRequest(parent context.Context, id string) (context.Context, func(), error) {
	if !galleryRequestIDValid(id) {
		return nil, nil, errors.New("invalid gallery request id")
	}
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	stopLifetime := func() bool { return false }
	if a.ctx != nil {
		stopLifetime = context.AfterFunc(a.ctx, cancel)
	}
	state := &a.backgroundGallery
	state.mu.Lock()
	if state.requests == nil {
		state.requests = make(map[string]*backgroundGalleryRequest)
	}
	for key, until := range state.canceled {
		if time.Now().After(until) {
			delete(state.canceled, key)
		}
	}
	_, precanceled := state.canceled[id]
	closing := state.closing || state.paused
	if closing || precanceled || state.requests[id] != nil || len(state.requests) >= 4 {
		state.mu.Unlock()
		stopLifetime()
		cancel()
		if precanceled || closing {
			return nil, nil, context.Canceled
		}
		return nil, nil, errors.New("gallery request unavailable")
	}
	request := &backgroundGalleryRequest{cancel: cancel, done: make(chan struct{})}
	state.requests[id] = request
	state.mu.Unlock()
	var once sync.Once
	finish := func() {
		once.Do(func() {
			stopLifetime()
			cancel()
			state.mu.Lock()
			if state.requests[id] == request {
				delete(state.requests, id)
			}
			close(request.done)
			state.mu.Unlock()
		})
	}
	return ctx, finish, nil
}

func (a *App) cancelBackgroundGalleryRequest(id string) bool {
	state := &a.backgroundGallery
	state.mu.Lock()
	request := state.requests[id]
	if request == nil {
		if state.canceled == nil {
			state.canceled = make(map[string]time.Time)
		}
		for key, until := range state.canceled {
			if time.Now().After(until) {
				delete(state.canceled, key)
			}
		}
		if len(state.canceled) < 128 {
			state.canceled[id] = time.Now().Add(time.Minute)
		}
	}
	state.mu.Unlock()
	if request != nil {
		request.cancel()
		return true
	}
	return false
}

func (a *App) shutdownBackgroundGallery() bool {
	if a == nil {
		return true
	}
	state := &a.backgroundGallery
	state.mu.Lock()
	state.closing = true
	requests := make([]*backgroundGalleryRequest, 0, len(state.requests))
	for _, request := range state.requests {
		requests = append(requests, request)
	}
	state.mu.Unlock()
	for _, request := range requests {
		request.cancel()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, request := range requests {
		select {
		case <-request.done:
		case <-ctx.Done():
			return false
		}
	}
	return true
}

// Resolve proxy preferences for each request, without keeping abandoned pools.
type backgroundGalleryProxyTransport struct{}

func (backgroundGalleryProxyTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	client := newStrictHTTPClientWithGlobalProxy(0)
	transport := client.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	cleanup := func() {}
	if closer, ok := transport.(interface{ CloseIdleConnections() }); ok {
		cleanup = closer.CloseIdleConnections
	}
	response, err := transport.RoundTrip(request)
	if err != nil {
		cleanup()
		return nil, err
	}
	response.Body = &backgroundGalleryResponseBody{ReadCloser: response.Body, cleanup: cleanup}
	return response, nil
}

type backgroundGalleryResponseBody struct {
	io.ReadCloser
	cleanup func()
}

func (body *backgroundGalleryResponseBody) Close() error {
	err := body.ReadCloser.Close()
	body.cleanup()
	return err
}
