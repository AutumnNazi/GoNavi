package app

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/plugin"
	"GoNavi-Wails/internal/pluginmarket"
)

func newApprovalMarket(t *testing.T, a *App) (string, string, string) {
	t.Helper()
	// The real host honors global proxy preferences. Local HTTP fixtures must
	// isolate that shared setting and restore it after their own requests finish.
	previousProxy := currentGlobalProxyConfig()
	if _, err := setGlobalProxyConfig(false, connection.ProxyConfig{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := setGlobalProxyConfig(previousProxy.Enabled, previousProxy.Proxy); err != nil {
			t.Error(err)
		}
	})
	manifest := plugin.Manifest{SchemaVersion: 1, APIVersion: 1, ID: "test.market", Name: "Actual package", Version: "1.0.0", Permissions: []string{"network"}}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	zw := zip.NewWriter(&archive)
	w, err := zw.Create("gonavi.plugin.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = w.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err = zw.Close(); err != nil {
		t.Fatal(err)
	}
	body := archive.Bytes()
	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/plugins/test.market/versions/1.0.0/artifact":
			w.Header().Set("Content-Type", "application/json")
			payload := pluginmarket.Artifact{URL: server.URL + "/api/v1/artifacts/" + digest, SHA256: digest, SizeBytes: int64(len(body)), Platform: "any", Version: "1.0.0"}
			if err := json.NewEncoder(w).Encode(payload); err != nil {
				t.Errorf("encode artifact: %v", err)
			}
		case "/api/v1/artifacts/" + digest:
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Length", strconv.Itoa(len(body)))
			if _, err := w.Write(body); err != nil {
				t.Errorf("write artifact: %v", err)
			}
		case "/api/v1/plugins/test.market":
			// Deliberately inaccurate metadata: consent must use actual downloaded bytes.
			manifest.Permissions = []string{}
			payload, _ := json.Marshal(manifest)
			if _, err := w.Write(payload); err != nil {
				t.Errorf("write metadata: %v", err)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	configured := a.PluginMarketConfigure(server.URL + "/api/v1")
	if !configured.Success {
		t.Fatalf("configure: %+v", configured)
	}
	settings := configured.Data.(pluginmarket.Settings)
	return server.URL + "/api/v1", digest, settings.SourceID
}

func inspectedMarketQuote(t *testing.T, a *App, digest, source string) PluginMarketInspection {
	t.Helper()
	result := a.PluginMarketInspect("test.market", "1.0.0", digest, source)
	if !result.Success {
		t.Fatalf("inspection: %+v", result)
	}
	quote, ok := result.Data.(PluginMarketInspection)
	if !ok {
		t.Fatalf("unexpected inspection %T", result.Data)
	}
	return quote
}

func TestPluginMarketConsentUsesInspectedManifestAndOneUseToken(t *testing.T) {
	a := newPluginTestApp(t)
	_, digest, source := newApprovalMarket(t, a)
	if result := a.PluginMarketInstall("test.market", "1.0.0", digest, true, ""); result.Success {
		t.Fatal("metadata-only trust accepted")
	}
	quote := inspectedMarketQuote(t, a, digest, source)
	if len(quote.Inspection.Manifest.Permissions) != 1 || quote.Inspection.Manifest.Permissions[0] != "network" {
		t.Fatal("displayed metadata instead of actual manifest")
	}
	if quote.Inspection.Digest == digest {
		t.Fatal("canonical and transport digests conflated")
	}
	result := a.PluginMarketInstall("test.market", "1.0.0", digest, true, quote.ApprovalToken)
	if !result.Success {
		t.Fatalf("approved install: %+v", result)
	}
	status := result.Data.(plugin.Status)
	if status.DesiredEnabled || status.State != plugin.StateDisabled {
		t.Fatal("install activated code")
	}
	if replay := a.PluginMarketInstall("test.market", "1.0.0", digest, true, quote.ApprovalToken); replay.Success {
		t.Fatal("approval replay accepted")
	}
}

func TestPluginMarketApprovalCancelExpiryAndSourceChange(t *testing.T) {
	for _, scenario := range []string{"cancel", "expire", "source", "tamper"} {
		t.Run(scenario, func(t *testing.T) {
			a := newPluginTestApp(t)
			base, digest, source := newApprovalMarket(t, a)
			quote := inspectedMarketQuote(t, a, digest, source)
			a.pluginMarket.mu.Lock()
			approval := a.pluginMarket.approvals[quote.ApprovalToken]
			path := approval.path
			if scenario == "expire" {
				approval.expires = time.Now().Add(-time.Second)
			}
			a.pluginMarket.mu.Unlock()
			switch scenario {
			case "cancel":
				if result := a.PluginMarketCancelInspection(quote.ApprovalToken); !result.Success {
					t.Fatal("cancel failed")
				}
			case "source":
				if result := a.PluginMarketConfigure(base + "/other"); !result.Success {
					t.Fatalf("configure: %+v", result)
				}
			case "tamper":
				if err := os.WriteFile(path, []byte("tampered"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if result := a.PluginMarketInstall("test.market", "1.0.0", digest, true, quote.ApprovalToken); result.Success {
				t.Fatalf("%s approval accepted", scenario)
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatalf("preview not released: %v", err)
			}
			list := a.PluginList()
			if !list.Success || len(list.Data.([]plugin.Status)) != 0 {
				t.Fatalf("failed approval mutated install state: %+v", list)
			}
		})
	}
}

func TestPluginMarketApprovalShutdownReleasesPreparedArchives(t *testing.T) {
	a := newPluginTestApp(t)
	_, digest, source := newApprovalMarket(t, a)
	quote := inspectedMarketQuote(t, a, digest, source)
	a.pluginMarket.mu.Lock()
	path := a.pluginMarket.approvals[quote.ApprovalToken].path
	a.pluginMarket.mu.Unlock()
	a.shutdownPluginMarket()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("preview leaked after shutdown: %v", err)
	}
	if result := a.PluginMarketInstall("test.market", "1.0.0", digest, true, quote.ApprovalToken); result.Success {
		t.Fatal("shutdown approval remained valid")
	}
}
