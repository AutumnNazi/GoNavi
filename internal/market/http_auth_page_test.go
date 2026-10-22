package market

import (
	"net/http/httptest"
	"strings"
	"testing"

	"GoNavi-Wails/shared/i18n"
)

func TestAuthLanguageNegotiation(t *testing.T) {
	cases := []struct {
		header string
		want   i18n.Language
	}{
		{header: "", want: i18n.LanguageEnUS},
		{header: "de-DE,de;q=0.9,en;q=0.5", want: i18n.LanguageDeDE},
		{header: "en-US;q=0.2,ja-JP;q=1", want: i18n.LanguageJaJP},
		{header: "zh-Hant-TW", want: i18n.LanguageZhTW},
		{header: "zh-CN", want: i18n.LanguageZhCN},
		{header: "ru", want: i18n.LanguageRuRU},
		{header: "invalid!", want: i18n.LanguageEnUS},
		{header: strings.Repeat("x", 1025), want: i18n.LanguageEnUS},
	}
	for _, test := range cases {
		t.Run(test.header, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/", nil)
			request.Header.Set("Accept-Language", test.header)
			if got := authLanguage(request); got != test.want {
				t.Fatalf("language=%s want=%s", got, test.want)
			}
		})
	}
}

func TestAuthPagesUseSharedCatalogWithoutMutatingLanguage(t *testing.T) {
	f := newHTTPFixture(t)
	f.server.identity = identityFixture{}
	for _, lang := range i18n.SupportedLanguages() {
		request := httptest.NewRequest("GET", "http://localhost:8090/api/v1/auth/device", nil)
		request.Header.Set("Accept-Language", string(lang))
		response := httptest.NewRecorder()
		f.handler.ServeHTTP(response, request)
		assertStatus(t, response, 200)
		if strings.Contains(response.Body.String(), "plugin.market.web.") {
			t.Fatalf("missing embedded auth translation for %s", lang)
		}
		if !strings.Contains(response.Body.String(), `lang="`+string(lang)+`"`) {
			t.Fatal("wrong page language")
		}
	}
	if f.server.localizer.Language() != i18n.LanguageEnUS {
		t.Fatal("request mutated shared localizer")
	}
}

func TestAuthConsentEscapesIdentityAndDeviceData(t *testing.T) {
	f := newHTTPFixture(t)
	request := httptest.NewRequest("GET", "http://localhost:8090/api/v1/auth/github/callback", nil)
	response := httptest.NewRecorder()
	f.server.offerConsent(response, request, Account{ID: "42", Login: "<script>alert(1)</script>"}, "ABCDE-12345")
	assertStatus(t, response, 200)
	if strings.Contains(response.Body.String(), "<script>") || !strings.Contains(response.Body.String(), "&lt;script&gt;") {
		t.Fatal("identity escaped HTML template boundary")
	}
	if !strings.Contains(response.Body.String(), "ABCDE-12345") {
		t.Fatal("device code missing from consent")
	}
}
