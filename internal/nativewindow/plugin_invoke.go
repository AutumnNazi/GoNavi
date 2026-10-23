package nativewindow

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"time"
)

var pluginRequestIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)

func (c *PluginController) serveInvoke(w http.ResponseWriter, r *http.Request, entry *pluginWindowEntry) {
	if !pluginMethod(w, r, http.MethodPost) {
		return
	}
	c.mu.Lock()
	if entry.closing || entry.invokeCalls >= pluginMaxCalls {
		c.mu.Unlock()
		pluginHTTPError(w, http.StatusTooManyRequests, "call_limit")
		return
	}
	entry.invokeCalls++
	c.mu.Unlock()
	defer func() { c.mu.Lock(); entry.invokeCalls--; c.mu.Unlock() }()
	var request pluginInvokeRequest
	if err := decodePluginJSON(w, r, &request, pluginMaxJSONBytes); err != nil ||
		!pluginRequestIDPattern.MatchString(request.ID) || request.Command == "" || len(request.Command) > 256 {
		pluginHTTPError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	ctx, release, err := c.beginInvoke(r.Context(), entry, request.ID)
	if err != nil {
		pluginHTTPError(w, http.StatusTooManyRequests, "window_busy_or_revoked")
		return
	}
	defer release()
	result, err := c.manager.InvokeGeneration(ctx, entry.info.PluginID, entry.info.Generation, request.Command, request.Arguments)
	if err != nil || ctx.Err() != nil {
		pluginHTTPError(w, http.StatusBadGateway, "invocation_failed")
		return
	}
	if _, err := c.entryStatus(entry); err != nil {
		pluginHTTPError(w, http.StatusGone, "generation_revoked")
		return
	}
	if len(result) > pluginMaxJSONBytes || !json.Valid(result) {
		pluginHTTPError(w, http.StatusBadGateway, "invalid_response")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	writePluginBody(w, result)
}

func (c *PluginController) beginInvoke(parent context.Context, entry *pluginWindowEntry, id string) (context.Context, func(), error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if entry.closing || len(entry.requests) >= pluginMaxCalls {
		return nil, nil, errors.New("window busy or revoked")
	}
	if _, exists := entry.requests[id]; exists {
		return nil, nil, errors.New("duplicate request id")
	}
	if expiry, exists := entry.canceledRequests[id]; exists && time.Now().Before(expiry) {
		return nil, nil, errors.New("request already canceled")
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	stop := context.AfterFunc(entry.life, cancel)
	entry.requests[id] = cancel
	release := func() {
		stop()
		cancel()
		c.mu.Lock()
		delete(entry.requests, id)
		c.mu.Unlock()
	}
	return ctx, release, nil
}

func (c *PluginController) serveCancel(w http.ResponseWriter, r *http.Request, entry *pluginWindowEntry) {
	if !pluginMethod(w, r, http.MethodPost) {
		return
	}
	var request struct {
		ID string `json:"id"`
	}
	if err := decodePluginJSON(w, r, &request, 256); err != nil || !pluginRequestIDPattern.MatchString(request.ID) {
		pluginHTTPError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	c.mu.Lock()
	cancel := entry.requests[request.ID]
	now := time.Now()
	for id, expiry := range entry.canceledRequests {
		if !now.Before(expiry) {
			delete(entry.canceledRequests, id)
		}
	}
	if len(entry.canceledRequests) >= 64 {
		c.mu.Unlock()
		pluginHTTPError(w, http.StatusTooManyRequests, "cancel_limit")
		return
	}
	// Tombstones fence an abort that arrives before its invoke over a custom scheme.
	entry.canceledRequests[request.ID] = now.Add(35 * time.Second)
	c.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	w.WriteHeader(http.StatusNoContent)
}
