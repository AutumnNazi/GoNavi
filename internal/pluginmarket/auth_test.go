package pluginmarket

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"GoNavi-Wails/internal/secretstore"
)

func TestDeviceAuthorizationStoresTokensOnlyInSecretStore(t *testing.T) {
	var polls atomic.Int32
	var base string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/device":
			writeTestJSON(t, w, 201, DeviceAuthorization{DeviceCode: "grant", UserCode: "ABCD-EFGH", VerificationURI: base + "/api/v1/auth/device", IntervalSeconds: 5, ExpiresIn: 600})
		case "/api/v1/auth/device/token":
			var request struct {
				DeviceCode string `json:"deviceCode"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.DeviceCode != "grant" {
				t.Error("incorrect device poll")
				w.WriteHeader(400)
				return
			}
			switch polls.Add(1) {
			case 1:
				writeTestJSON(t, w, 200, deviceToken{Status: "pending"})
			case 2:
				writeTestJSON(t, w, 429, map[string]string{"code": "slow_down", "message": "slow_down"})
			default:
				writeTestJSON(t, w, 200, deviceToken{Status: "authorized", AccessToken: "private-access-token", ExpiresIn: 3600})
			}
		case "/api/v1/auth/logout":
			if r.Header.Get("Authorization") != "Bearer private-access-token" {
				t.Error("logout token missing")
			}
			writeTestJSON(t, w, 503, map[string]string{"code": "server_busy", "message": "offline"})
		default:
			t.Errorf("unexpected auth route: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	base = server.URL
	service, secrets := newTestService(t, base, false)
	var now atomic.Int64
	now.Store(time.Now().Unix())
	service.now = func() time.Time { return time.Unix(now.Load(), 0) }
	challenge, err := service.Login(t.Context())
	if err != nil || challenge.DeviceCode != "grant" {
		t.Fatalf("challenge=%+v, %v", challenge, err)
	}
	status, err := service.PollLogin(t.Context(), challenge.DeviceCode)
	if err != nil || status.Status != "pending" {
		t.Fatalf("initial poll=%+v, %v", status, err)
	}
	status, err = service.PollLogin(t.Context(), challenge.DeviceCode)
	if err != nil || status.Status != "pending" || polls.Load() != 1 {
		t.Fatal("client ignored polling interval")
	}
	now.Add(5)
	status, err = service.PollLogin(t.Context(), challenge.DeviceCode)
	if err != nil || status.Status != "pending" {
		t.Fatalf("slow poll=%+v, %v", status, err)
	}
	now.Add(5)
	status, err = service.PollLogin(t.Context(), challenge.DeviceCode)
	if err != nil || status.Status != "authorized" {
		t.Fatalf("authorization=%+v, %v", status, err)
	}
	public, err := json.Marshal(status)
	if err != nil || strings.Contains(string(public), "private-access-token") || strings.Contains(string(public), "accessToken") {
		t.Fatal("token exposed to UI")
	}
	settings, err := service.Settings()
	if err != nil || !settings.Authenticated {
		t.Fatalf("settings=%+v, %v", settings, err)
	}
	ref, err := tokenRef(settings.SourceID)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := secrets.Get(ref)
	if err != nil || !strings.Contains(string(payload), "private-access-token") {
		t.Fatalf("stored credential=%q, %v", payload, err)
	}
	if err = service.Logout(t.Context()); err == nil {
		t.Fatal("remote revocation failure concealed")
	}
	settings, err = service.Settings()
	if err != nil || settings.Authenticated {
		t.Fatalf("failed revocation retained local session: %+v, %v", settings, err)
	}
	if _, err = secrets.Get(ref); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("logout retained token: %v", err)
	}
}

func TestAuthenticationStatesNeverInventSuccessfulLogin(t *testing.T) {
	tests := []struct {
		name       string
		response   deviceToken
		want       string
		wantErr    bool
		putFailure bool
	}{
		{name: "denied", response: deviceToken{Status: "denied"}, want: "denied"},
		{name: "expired", response: deviceToken{Status: "expired"}, want: "expired"},
		{name: "unknown status", response: deviceToken{Status: "success"}, wantErr: true},
		{name: "missing bearer", response: deviceToken{Status: "authorized", ExpiresIn: 100}, wantErr: true},
		{name: "unsafe bearer", response: deviceToken{Status: "authorized", AccessToken: "token\r\ninjected", ExpiresIn: 100}, wantErr: true},
		{name: "missing expiry", response: deviceToken{Status: "authorized", AccessToken: "token"}, wantErr: true},
		{name: "secretstore failure", response: deviceToken{Status: "authorized", AccessToken: "token", ExpiresIn: 100}, wantErr: true, putFailure: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var base string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/token") {
					writeTestJSON(t, w, 200, test.response)
					return
				}
				writeTestJSON(t, w, 201, DeviceAuthorization{DeviceCode: "grant", UserCode: "CODE", VerificationURI: base + "/api/v1/auth/device", IntervalSeconds: 5, ExpiresIn: 600})
			}))
			defer server.Close()
			base = server.URL
			service, secrets := newTestService(t, base, false)
			if test.putFailure {
				secrets.putErr = &secretstore.UnavailableError{Reason: "denied"}
			}
			challenge, err := service.Login(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			status, err := service.PollLogin(t.Context(), challenge.DeviceCode)
			if (err != nil) != test.wantErr || status.Status != test.want {
				t.Fatalf("poll=%+v, %v", status, err)
			}
			settings, err := service.Settings()
			if err != nil || settings.Authenticated {
				t.Fatalf("non-authorized session=%+v, %v", settings, err)
			}
		})
	}
}

func TestLogoutFencesInFlightAuthorization(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var base string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/token") {
			close(entered)
			<-release
			writeTestJSON(t, w, 200, deviceToken{Status: "authorized", AccessToken: "late-token", ExpiresIn: 100})
			return
		}
		writeTestJSON(t, w, 201, DeviceAuthorization{DeviceCode: "grant", UserCode: "CODE", VerificationURI: base + "/api/v1/auth/device", IntervalSeconds: 5, ExpiresIn: 600})
	}))
	defer server.Close()
	base = server.URL
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	service, _ := newTestService(t, base, false)
	challenge, err := service.Login(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, err := service.PollLogin(t.Context(), challenge.DeviceCode); done <- err }()
	<-entered
	if err = service.Logout(t.Context()); err != nil {
		t.Fatal(err)
	}
	close(release)
	assertErrorIs(t, <-done, ErrUnknownDeviceCode)
	settings, err := service.Settings()
	if err != nil || settings.Authenticated {
		t.Fatal("late authorization resurrected session")
	}
}

func TestLoginRejectsForeignVerificationAndUnknownGrant(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		writeTestJSON(t, w, 201, DeviceAuthorization{
			DeviceCode: "grant", UserCode: "CODE", VerificationURI: "https://different.example/device", IntervalSeconds: 5, ExpiresIn: 600})
	}))
	defer server.Close()
	service, _ := newTestService(t, server.URL, false)
	_, err := service.PollLogin(t.Context(), "not-issued")
	assertErrorIs(t, err, ErrUnknownDeviceCode)
	if requests.Load() != 0 {
		t.Fatal("unknown code sent to network")
	}
	_, err = service.Login(t.Context())
	assertErrorIs(t, err, ErrInvalidResponse)
}

func TestCredentialsRemainSourceScopedAndExpire(t *testing.T) {
	service, _ := newTestService(t, "https://first.example", false)
	seedToken(t, service, "first-token")
	if _, err := service.Configure(t.Context(), "https://second.example"); err != nil {
		t.Fatal(err)
	}
	settings, err := service.Settings()
	if err != nil || settings.Authenticated {
		t.Fatal("credentials transferred to different origin")
	}
	if _, err = service.Configure(t.Context(), "https://first.example"); err != nil {
		t.Fatal(err)
	}
	settings, err = service.Settings()
	if err != nil || !settings.Authenticated {
		t.Fatal("original source session disappeared")
	}
	service.now = func() time.Time { return time.Now().Add(2 * time.Hour) }
	settings, err = service.Settings()
	if err != nil || settings.Authenticated {
		t.Fatal("expired token remained authenticated")
	}
	_, err = service.Rate(t.Context(), "publisher.plugin", 5, "", "1.0.0")
	assertErrorIs(t, err, ErrUnauthenticated)
}

func TestUnavailableSecretsDoNotBlockAnonymousBrowsing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { writeTestJSON(t, w, 200, CatalogPage{Items: []Item{}}) }))
	defer server.Close()
	service, err := NewService(Options{Root: t.TempDir(), Secrets: secretstore.NewUnavailableStore("not available")})
	if err != nil {
		t.Fatal(err)
	}
	settings, err := service.Configure(t.Context(), server.URL)
	if err != nil || settings.Authenticated {
		t.Fatalf("anonymous configure=%+v, %v", settings, err)
	}
	if _, err = service.Catalog(t.Context(), "", "", ""); err != nil {
		t.Fatalf("anonymous catalog unavailable: %v", err)
	}
}

type blockingSecrets struct {
	*fakeSecrets
	enabled atomic.Bool
	entered chan struct{}
	release chan struct{}
}

func (s *blockingSecrets) Get(ref string) ([]byte, error) {
	if s.enabled.CompareAndSwap(true, false) {
		close(s.entered)
		<-s.release
	}
	return s.fakeSecrets.Get(ref)
}

func TestBlockingSecretReadDoesNotHoldServiceMutex(t *testing.T) {
	secrets := &blockingSecrets{fakeSecrets: newFakeSecrets(), entered: make(chan struct{}), release: make(chan struct{})}
	service, err := NewService(Options{Root: t.TempDir(), Secrets: secrets})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Configure(t.Context(), "https://first.example"); err != nil {
		t.Fatal(err)
	}
	secrets.enabled.Store(true)
	done := make(chan error, 1)
	go func() { _, err := service.Settings(); done <- err }()
	<-secrets.entered
	configured := make(chan error, 1)
	go func() { _, err := service.Configure(t.Context(), "https://second.example"); configured <- err }()
	select {
	case err = <-configured:
		if err != nil {
			t.Error(err)
		}
	case <-time.After(time.Second):
		t.Error("secretstore read held global state mutex")
	}
	close(secrets.release)
	assertErrorIs(t, <-done, ErrSourceChanged)
}
