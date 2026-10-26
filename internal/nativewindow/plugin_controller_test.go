package nativewindow

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginWindowRevokeIsImmediateAndKillsUncooperativeChild(t *testing.T) {
	c, _ := newPluginTestController(t)
	entry := openPluginTestWindow(t, c, "test.one")
	process := entry.process.(*pluginProcessFake)
	started := time.Now()
	c.Revoke("test.one")
	if time.Since(started) > 100*time.Millisecond {
		t.Fatal("revoke waited for child cooperation")
	}
	response := servePluginTest(c, entry, http.MethodGet, pluginBridgePrefix+"bootstrap", "")
	if response.Code != http.StatusGone {
		t.Fatalf("revoked bridge status = %d", response.Code)
	}
	state := servePluginTest(c, entry, http.MethodGet, pluginBridgePrefix+"state", "")
	if state.Code != http.StatusOK || !strings.Contains(state.Body.String(), "true") {
		t.Fatal("child cannot observe host close")
	}
	awaitPluginDone(t, entry.done)
	if process.kills.Load() != 1 {
		t.Fatal("hung child was not killed exactly once")
	}
}

func TestPluginWindowGenerationChangeClosesOldChild(t *testing.T) {
	c, runtime := newPluginTestController(t)
	entry := openPluginTestWindow(t, c, "test.one")
	runtime.mu.Lock()
	runtime.statuses[0].Generation++
	runtime.mu.Unlock()
	awaitPluginDone(t, entry.done)
	newEntry := openPluginTestWindow(t, c, "test.one")
	if newEntry.info.Generation != 2 || newEntry.token == entry.token || newEntry.profile == entry.profile {
		t.Fatal("new generation reused old capability/profile")
	}
	response := servePluginTest(c, entry, http.MethodGet, pluginBridgePrefix+"bootstrap", "")
	if response.Code != http.StatusUnauthorized {
		t.Fatal("old token was not revoked")
	}
}

func TestPluginWindowProcessHealthRequiresDocumentHeartbeat(t *testing.T) {
	for _, mode := range []string{"startup", "stalled", "state-poll-is-not-heartbeat"} {
		t.Run(mode, func(t *testing.T) {
			c, _ := newPluginTestController(t)
			c.startupTimeout = 50 * time.Millisecond
			c.heartbeatTimeout = 40 * time.Millisecond
			entry := openPluginTestWindow(t, c, "test.one")
			if mode == "stalled" {
				response := servePluginTest(c, entry, http.MethodPost, pluginBridgePrefix+"heartbeat", `{"sequence":1}`)
				if response.Code != http.StatusNoContent {
					t.Fatal(response.Body.String())
				}
				replay := servePluginTest(c, entry, http.MethodPost, pluginBridgePrefix+"heartbeat", `{"sequence":1}`)
				if replay.Code != http.StatusConflict {
					t.Fatal("heartbeat replay accepted")
				}
			}
			if mode == "state-poll-is-not-heartbeat" {
				for range 10 {
					servePluginTest(c, entry, http.MethodGet, pluginBridgePrefix+"state", "")
				}
			}
			awaitPluginDone(t, entry.done)
		})
	}
}

func TestPluginWindowIndependentCapabilitiesAndProfiles(t *testing.T) {
	c, runtime := newPluginTestController(t)
	runtime.mu.Lock()
	other := runtime.statuses[0]
	other.Manifest = plugin.Manifest{ID: "test.two", Name: "Other", Window: &plugin.Window{Entry: "index.html"}}
	runtime.statuses = append(runtime.statuses, other)
	runtime.mu.Unlock()
	first := openPluginTestWindow(t, c, "test.one")
	second := openPluginTestWindow(t, c, "test.two")
	if first.profile == second.profile || first.token == second.token {
		t.Fatal("plugins shared profile or capability")
	}
	first.process.(*pluginProcessFake).exit()
	awaitPluginDone(t, first.done)
	response := servePluginTest(c, second, http.MethodGet, pluginBridgePrefix+"bootstrap", "")
	if response.Code != http.StatusOK {
		t.Fatal("one child exit affected another")
	}
}

func TestPluginWindowOpenFailureAndShutdown(t *testing.T) {
	c, _ := newPluginTestController(t)
	var profile string
	c.startProcess = func(spec pluginProcessSpec) (pluginProcess, error) {
		profile = spec.directory
		return nil, errors.New("fixture launch failure")
	}
	if _, err := c.Open(context.Background(), "test.one"); err == nil {
		t.Fatal("launch failure hidden")
	}
	if _, err := os.Stat(profile); !os.IsNotExist(err) {
		t.Fatal("failed launch leaked profile")
	}
	c.mu.Lock()
	count := len(c.windows)
	c.mu.Unlock()
	if count != 0 {
		t.Fatal("failed launch leaked registry")
	}
	if err := c.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Open(context.Background(), "test.one"); err == nil {
		t.Fatal("closed controller reopened")
	}
}

func TestPluginWindowCloseCallerDeadlineDoesNotStopReaping(t *testing.T) {
	c, _ := newPluginTestController(t)
	entry := openPluginTestWindow(t, c, "test.one")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := c.Close(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Close = %v", err)
	}
	awaitPluginDone(t, entry.done)
}
