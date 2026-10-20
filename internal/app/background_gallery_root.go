package app

import (
	"context"
	"sync"
	"time"
)

// A root lease spans service lookup, request registration and the entire operation.
func (a *App) beginBackgroundGalleryOperation() (func(), error) {
	state := &a.backgroundGallery
	state.mu.Lock()
	blocked := state.paused || state.closing
	state.mu.Unlock()
	if blocked {
		return nil, context.Canceled
	}
	state.operations.RLock()
	state.mu.Lock()
	blocked = state.paused || state.closing
	state.mu.Unlock()
	if blocked {
		state.operations.RUnlock()
		return nil, context.Canceled
	}
	return state.operations.RUnlock, nil
}

// suspendBackgroundGallery closes admission before cancellation, then waits for
// all root leases. The caller holds the returned exclusive lease while migrating.
func (a *App) suspendBackgroundGallery() (func(), error) {
	state := &a.backgroundGallery
	state.mu.Lock()
	if state.paused || state.closing {
		state.mu.Unlock()
		return nil, context.Canceled
	}
	state.paused = true
	requests := make([]*backgroundGalleryRequest, 0, len(state.requests))
	for _, request := range state.requests {
		requests = append(requests, request)
	}
	state.mu.Unlock()
	for _, request := range requests {
		request.cancel()
	}
	ctx, cancel := context.WithTimeout(a.galleryContext(), 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for !state.operations.TryLock() {
		select {
		case <-ctx.Done():
			state.mu.Lock()
			state.paused = false
			state.mu.Unlock()
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			state.mu.Lock()
			state.service = nil
			state.root = ""
			state.paused = false
			state.mu.Unlock()
			state.operations.Unlock()
		})
	}, nil
}
