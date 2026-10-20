package xxljob

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
)

func connectFake(t *testing.T, admin *fakeAdmin) (*Client, *ConnectInfo, error) {
	t.Helper()
	ctx, cancel := testContext(t)
	defer cancel()
	client := NewClient()
	t.Cleanup(func() { _ = client.Close() })
	info, err := client.Connect(ctx, admin.testConfig(t))
	if err != nil {
		return nil, nil, err
	}
	return client, info, nil
}

func mustConnectFake(t *testing.T, admin *fakeAdmin) (*Client, *ConnectInfo) {
	t.Helper()
	client, info, err := connectFake(t, admin)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	return client, info
}

func TestConnectDetectsProtocolStack(t *testing.T) {
	cases := []struct {
		flavor     adminFlavor
		wantFamily string
		wantLogin  LoginFamily
		wantPaging PaginationFamily
		wantFields FieldEra
	}{
		{flavor2x, "2.x", LoginLegacy, PageStartLength, FieldLegacy},
		{flavor32x, "3.2.x", LoginSSO, PageStartLength, FieldLegacy},
		{flavor35, "3.3+", LoginSSO, PageOffsetPageSize, FieldRenamed},
	}
	for _, tc := range cases {
		t.Run(tc.flavor.name, func(t *testing.T) {
			admin := newFakeAdmin(t, tc.flavor, "")
			_, info := mustConnectFake(t, admin)

			if info.ProtocolFamily != tc.wantFamily {
				t.Fatalf("family = %q, want %q", info.ProtocolFamily, tc.wantFamily)
			}
			if info.LoginFamily != string(tc.wantLogin) {
				t.Errorf("login = %q, want %q", info.LoginFamily, tc.wantLogin)
			}
			if info.PaginationFamily != string(tc.wantPaging) {
				t.Errorf("paging = %q, want %q", info.PaginationFamily, tc.wantPaging)
			}
			if info.FieldEra != string(tc.wantFields) {
				t.Errorf("fields = %q, want %q", info.FieldEra, tc.wantFields)
			}
		})
	}
}

func TestConnectUsesVersionSpecificLoginRoute(t *testing.T) {
	for _, flavor := range allFlavors {
		t.Run(flavor.name, func(t *testing.T) {
			admin := newFakeAdmin(t, flavor, "")
			mustConnectFake(t, admin)

			want := "/login"
			if flavor.login == LoginSSO {
				want = "/auth/doLogin"
			}
			if _, ok := admin.lastCallTo(want); !ok {
				t.Fatalf("expected a call to %s, got %v", want, admin.recorded())
			}
		})
	}
}

func TestConnectHonorsContextPath(t *testing.T) {
	admin := newFakeAdmin(t, flavor2x, "/xxl-job-admin")
	_, info := mustConnectFake(t, admin)
	if info.LoginRedirect != "/xxl-job-admin/toLogin" {
		t.Fatalf("redirect = %q, want /xxl-job-admin/toLogin", info.LoginRedirect)
	}
	if _, ok := admin.lastCallTo("/xxl-job-admin/login"); !ok {
		t.Fatalf("expected login under the context path, got %v", admin.recorded())
	}
}

func TestConnectRejectsBadCredentials(t *testing.T) {
	admin := newFakeAdmin(t, flavor2x, "")
	ctx, cancel := testContext(t)
	defer cancel()

	cfg := admin.testConfig(t)
	cfg.Password = "wrong"

	client := NewClient()
	defer client.Close()
	_, err := client.Connect(ctx, cfg)
	if err == nil {
		t.Fatal("expected a login failure")
	}
	// A refused password is not an expired session: telling the operator to
	// "reconnect" hides the only thing they can fix.
	if !errors.Is(err, ErrCredentialRejected) {
		t.Fatalf("error = %v, want ErrCredentialRejected", err)
	}
	if errors.Is(err, ErrSessionExpired) {
		t.Fatal("a refused password must not be reported as an expired session")
	}
	if message := err.Error(); containsSecret(message) {
		t.Fatalf("error text leaked a secret: %q", message)
	}
}

func TestConnectFallsBackToOtherLoginRoute(t *testing.T) {
	// A deployment whose root redirect is customized cannot be classified up
	// front; the client must still find the working login route.
	admin := newFakeAdmin(t, flavor2x, "")
	admin.redirectToCustomPage()
	client := NewClient()
	defer client.Close()
	if _, err := connectWith(t, client, admin.testConfig(t)); err != nil {
		t.Fatalf("connect with a custom login page: %v", err)
	}
}

func connectWith(t *testing.T, client *Client, cfg connection.ConnectionConfig) (*ConnectInfo, error) {
	t.Helper()
	ctx, cancel := testContext(t)
	defer cancel()
	return client.Connect(ctx, cfg)
}

func TestSessionReloginsOnceOnExpiry(t *testing.T) {
	cases := []struct {
		flavor adminFlavor
		shape  expiryShape
	}{
		{flavor2x, expiryRedirect302},
		{flavor35, expiryCode500},
	}
	for _, tc := range cases {
		t.Run(tc.flavor.name+"/"+string(tc.shape), func(t *testing.T) {
			admin := newFakeAdmin(t, tc.flavor, "")
			client, _ := mustConnectFake(t, admin)
			protocol := client.NewProtocol()
			ctx, cancel := testContext(t)
			defer cancel()

			// One successful listing, then the session goes stale.
			if _, err := protocol.ListJobGroups(ctx, GroupListRequest{Page: 1, Size: 10}); err != nil {
				t.Fatalf("first listing: %v", err)
			}
			admin.expireSessions(tc.shape, 1)

			// The next call must recover silently through one re-login.
			if _, err := protocol.ListJobGroups(ctx, GroupListRequest{Page: 1, Size: 10}); err != nil {
				t.Fatalf("listing after expiry should re-login, got %v", err)
			}
			logins := 0
			for _, call := range admin.recorded() {
				if call.Path == "/login" || call.Path == "/auth/doLogin" {
					logins++
				}
			}
			if logins < 2 {
				t.Fatalf("expected a second login, saw %d logins", logins)
			}
		})
	}
}

func TestSessionExpirySurfacesAfterFailedRelogin(t *testing.T) {
	admin := newFakeAdmin(t, flavor35, "")
	client, _ := mustConnectFake(t, admin)
	protocol := client.NewProtocol()
	ctx, cancel := testContext(t)
	defer cancel()

	admin.expireSessions(expiryCode500, 1)
	// The re-login fails with an expiry-shaped answer rather than a refused
	// password, so the caller is told the session is gone.
	admin.rejectLoginsWith("xxl-job login expired, please login again")
	if _, err := protocol.ListJobGroups(ctx, GroupListRequest{Page: 1, Size: 10}); !errors.Is(err, ErrSessionExpired) {
		t.Fatalf("error = %v, want ErrSessionExpired", err)
	}
}

func TestCredentialRejectionDoesNotRetryTheOtherLoginRoute(t *testing.T) {
	// The admin answered the login route and refused the credentials, so the
	// password must not be sent a second time to the other family's endpoint.
	admin := newFakeAdmin(t, flavor35, "")
	admin.rejectLogins(true)
	ctx, cancel := testContext(t)
	defer cancel()

	client := NewClient()
	defer client.Close()
	if _, err := client.Connect(ctx, admin.testConfig(t)); !errors.Is(err, ErrCredentialRejected) {
		t.Fatalf("error = %v, want ErrCredentialRejected", err)
	}
	for _, call := range admin.recorded() {
		if call.Path == "/login" {
			t.Fatalf("the legacy login route must not be tried after a refused credential: %v", admin.recorded())
		}
	}
}

func TestBusinessErrorIsNotTreatedAsExpiredSession(t *testing.T) {
	admin := newFakeAdmin(t, flavor35, "")
	client, _ := mustConnectFake(t, admin)
	ctx, cancel := testContext(t)
	defer cancel()

	// A 500 naming no auth problem must surface as a remote error and must not
	// send the client into a re-login loop.
	admin.nextBusinessError("job group not found")
	_, err := client.NewProtocol().ListJobGroups(ctx, GroupListRequest{Page: 1, Size: 10})
	if !errors.Is(err, ErrRemote) {
		t.Fatalf("error = %v, want ErrRemote", err)
	}
	if errors.Is(err, ErrSessionExpired) {
		t.Fatal("a business error must not be reported as an expired session")
	}
	logins := 0
	for _, call := range admin.recorded() {
		if call.Path == "/auth/doLogin" {
			logins++
		}
	}
	if logins != 1 {
		t.Fatalf("expected no extra login, saw %d", logins)
	}
}

func TestNotConnectedClientRejectsCalls(t *testing.T) {
	client := NewClient()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	if _, err := client.NewProtocol().ListJobGroups(ctx, GroupListRequest{Page: 1, Size: 10}); err == nil {
		t.Fatal("expected an error from an unconnected client")
	}
}

// containsSecret reports whether the password leaked into a message.
func containsSecret(text string) bool {
	return strings.Contains(text, "123456") || strings.Contains(text, "wrong")
}
