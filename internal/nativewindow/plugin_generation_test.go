package nativewindow

import (
	"context"
	"net/http"
	"testing"
)

func TestPluginRevokeFencesAnOpeningWindow(t *testing.T) {
	c, runtime := newPluginTestController(t)
	entered := make(chan struct{})
	release := make(chan struct{})
	runtime.beforeAsset = func() { close(entered); <-release }
	// A one-result buffer lets the goroutine finish even if an assertion fails.
	result := make(chan error, 1)
	go func() { _, err := c.Open(context.Background(), "test.one"); result <- err }()
	<-entered
	c.Revoke("test.one")
	close(release)
	if err := <-result; err == nil {
		t.Fatal("window admitted after its opening generation was revoked")
	}
	c.mu.Lock()
	count := len(c.windows)
	c.mu.Unlock()
	if count != 0 {
		t.Fatal("revoked admission launched a process")
	}
}

func TestPluginRevokeDoesNotNeedRuntimeLock(t *testing.T) {
	c, runtime := newPluginTestController(t)
	entry := openPluginTestWindow(t, c, "test.one")
	runtime.mu.Lock()
	c.Revoke("test.one")
	runtime.mu.Unlock()
	if entry.life.Err() == nil {
		t.Fatal("capability was not immediately canceled")
	}
	awaitPluginDone(t, entry.done)
}

func TestPluginWindowReinstallIdentityIsFenced(t *testing.T) {
	c, runtime := newPluginTestController(t)
	entry := openPluginTestWindow(t, c, "test.one")
	runtime.mu.Lock()
	runtime.statuses[0].InstalledAt = "reinstalled"
	runtime.mu.Unlock()
	response := servePluginTest(c, entry, http.MethodGet, pluginBridgePrefix+"bootstrap", "")
	if response.Code != http.StatusGone {
		t.Fatal("old capability reached replacement installation")
	}
	awaitPluginDone(t, entry.done)
	next := openPluginTestWindow(t, c, "test.one")
	if next.stamp.installedAt != "reinstalled" {
		t.Fatal("new installation cannot open")
	}
}

func TestPluginUserCloseAllowsExplicitReopen(t *testing.T) {
	c, _ := newPluginTestController(t)
	entry := openPluginTestWindow(t, c, "test.one")
	response := servePluginTest(c, entry, http.MethodPost, pluginBridgePrefix+"close", "{}")
	if response.Code != http.StatusNoContent {
		t.Fatal(response.Body.String())
	}
	awaitPluginDone(t, entry.done)
	next := openPluginTestWindow(t, c, "test.one")
	if next.info.ID == entry.info.ID {
		t.Fatal("closed child capability was reused")
	}
}

func TestPluginReloadCanRestartDocumentHeartbeatSequence(t *testing.T) {
	c, _ := newPluginTestController(t)
	entry := openPluginTestWindow(t, c, "test.one")
	if response := servePluginTest(c, entry, http.MethodPost, pluginBridgePrefix+"heartbeat", `{"sequence":100}`); response.Code != 204 {
		t.Fatal(response.Body.String())
	}
	if response := servePluginTest(c, entry, http.MethodGet, pluginBridgePrefix+"bootstrap", ""); response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	if response := servePluginTest(c, entry, http.MethodPost, pluginBridgePrefix+"heartbeat", `{"sequence":1}`); response.Code != 204 {
		t.Fatal("reload heartbeat rejected")
	}
}
