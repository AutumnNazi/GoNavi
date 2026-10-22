package market

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

type unavailableCatalog struct{ Repository }

func (r unavailableCatalog) Catalog(context.Context, CatalogQuery) (CatalogPage, error) {
	return CatalogPage{}, errors.New("database connection string contains sensitive detail")
}

func TestRepositoryFailureProducesStructuredErrorWithoutFallback(t *testing.T) {
	f := newHTTPFixture(t)
	f.server.repo = unavailableCatalog{Repository: f.repo}
	response := f.request("GET", "/plugins", "", nil)
	assertStatus(t, response, 500)
	failure := decodeResponse[APIError](t, response)
	if failure.Code != "internal_error" || strings.Contains(response.Body.String(), "sensitive") || strings.Contains(response.Body.String(), "items") {
		t.Fatal("internal failure leaked or became fake catalog")
	}
}

func TestSaturatedUploadPoolRejectsWithoutReadingPackage(t *testing.T) {
	f := newHTTPFixture(t)
	f.server.uploadSlots <- struct{}{}
	f.server.uploadSlots <- struct{}{}
	defer func() { <-f.server.uploadSlots; <-f.server.uploadSlots }()
	request := httptest.NewRequest("POST", "http://localhost:8090/api/v1/submissions", strings.NewReader("not multipart"))
	request.Header.Set("Authorization", "Bearer "+f.tokens["publisher"])
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, request)
	assertStatus(t, response, 503)
	if decodeResponse[APIError](t, response).Code != "upload_busy" {
		t.Fatal("upload pool ignored")
	}
}

func TestOAuthProviderDenialReachesDevice(t *testing.T) {
	f := newHTTPFixture(t)
	f.server.identity = identityFixture{}
	challenge := decodeResponse[DeviceAuthorization](t, f.request("POST", "/auth/device", "", nil))
	start := authRequest(f, "GET", "/auth/github?user_code="+challenge.UserCode, "", nil)
	cookie := start.Result().Cookies()[0]
	callback := authRequest(f, "GET", "/auth/github/callback?error=access_denied&state="+cookie.Value, "", cookie)
	assertStatus(t, callback, 401)
	response := f.request("POST", "/auth/device/token", "", strings.NewReader(`{"deviceCode":"`+challenge.DeviceCode+`"}`))
	token := decodeResponse[DeviceToken](t, response)
	if token.Status != "denied" || token.AccessToken != "" {
		t.Fatalf("status=%s", token.Status)
	}
}
