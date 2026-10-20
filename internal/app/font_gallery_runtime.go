package app

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"GoNavi-Wails/internal/fontgallery"
)

type fontGalleryRequest struct {
	cancel context.CancelFunc
	done   chan struct{}
}

type fontGalleryState struct {
	operations sync.RWMutex
	paused     bool
	mu         sync.Mutex
	root       string
	service    *fontgallery.Service
	requests   map[string]*fontGalleryRequest
	canceled   map[string]time.Time
	closing    bool
}

func (a *App) fontGalleryService() (*fontgallery.Service, error) {
	if a == nil || a.webRuntime || ConfigDirForIntegration(a) == "" {
		return nil, errors.New("font gallery runtime unavailable")
	}
	state := &a.fontGallery
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.closing || state.paused {
		return nil, context.Canceled
	}
	root := ConfigDirForIntegration(a)
	if state.service != nil && state.root == root {
		return state.service, nil
	}
	for _, request := range state.requests {
		request.cancel()
	}
	service, err := fontgallery.NewService(fontgallery.Options{Root: root, Client: &http.Client{Transport: backgroundGalleryProxyTransport{}}})
	if err != nil {
		return nil, err
	}
	state.root, state.service = root, service
	return service, nil
}

func (a *App) beginFontGalleryRequest(parent context.Context, id string) (context.Context, func(), error) {
	if !galleryRequestIDValid(id) {
		return nil, nil, errors.New("invalid font gallery request id")
	}
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	stopLifetime := func() bool { return false }
	if a.ctx != nil {
		stopLifetime = context.AfterFunc(a.ctx, cancel)
	}
	state := &a.fontGallery
	state.mu.Lock()
	if state.requests == nil {
		state.requests = make(map[string]*fontGalleryRequest)
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
		return nil, nil, errors.New("font gallery request unavailable")
	}
	request := &fontGalleryRequest{cancel: cancel, done: make(chan struct{})}
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

func (a *App) cancelFontGalleryRequest(id string) bool {
	state := &a.fontGallery
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

func (a *App) shutdownFontGallery() bool {
	if a == nil {
		return true
	}
	state := &a.fontGallery
	state.mu.Lock()
	state.closing = true
	requests := make([]*fontGalleryRequest, 0, len(state.requests))
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
