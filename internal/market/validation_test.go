package market

import (
	"encoding/base64"
	"errors"
	"net/url"
	"strings"
	"testing"
)

func TestCatalogQueryValidation(t *testing.T) {
	cases := []struct {
		name, query string
		valid       bool
	}{
		{name: "defaults", valid: true},
		{name: "filters", query: "q=reader&sort=rating&hostVersion=v1.2.3-rc.1&platform=linux/amd64&limit=100", valid: true},
		{name: "offset", query: "cursor=" + base64.RawURLEncoding.EncodeToString([]byte("24")), valid: true},
		{name: "negative", query: "limit=-1"},
		{name: "huge", query: "limit=101"},
		{name: "unsupported sort", query: "sort=score"},
		{name: "unsafe platform", query: "platform=../../x"},
		{name: "bad version", query: "hostVersion=1.2"},
		{name: "large offset", query: "cursor=" + base64.RawURLEncoding.EncodeToString([]byte("10001"))},
		{name: "large query", query: "q=" + strings.Repeat("x", 201)},
		{name: "nul query", query: "q=%00"},
		{name: "invalid utf8", query: "q=%FF"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			values, err := url.ParseQuery(test.query)
			if err != nil {
				t.Fatal(err)
			}
			_, err = parseCatalogQuery(values)
			if (err == nil) != test.valid {
				t.Fatalf("valid=%v err=%v", test.valid, err)
			}
		})
	}
}

func TestPublicOriginValidation(t *testing.T) {
	for _, raw := range []string{"https://market.example", "http://localhost:8090", "http://127.0.0.1:8090", "http://[::1]:8090"} {
		if _, _, err := validatePublicURL(raw); err != nil {
			t.Errorf("valid origin %s: %v", raw, err)
		}
	}
	for _, raw := range []string{"http://market.example", "https://user:secret@market.example", "https://market.example/path", "https://market.example?x=1", "javascript:alert(1)", ""} {
		if _, _, err := validatePublicURL(raw); !errors.Is(err, ErrInvalid) {
			t.Errorf("accepted unsafe origin %q", raw)
		}
	}
}

func TestRatingInputBounds(t *testing.T) {
	for _, r := range []Rating{{Stars: 0}, {Stars: 6}, {Stars: 4, Body: strings.Repeat("a", 4001)}, {Stars: 4, Body: string([]byte{0xff})}, {Stars: 4, Body: string([]byte{0})}, {Stars: 4, Version: "invalid"}, {Stars: 4, Version: strings.Repeat("a", 101)}} {
		if err := validateRating(r); !errors.Is(err, ErrInvalid) {
			t.Errorf("invalid rating accepted: %+v", r)
		}
	}
	if err := validateRating(Rating{Stars: 5, Body: strings.Repeat("a", 4000)}); err != nil {
		t.Fatal(err)
	}
}

func TestSecureIdentifiersAndVersions(t *testing.T) {
	a, err := newSecret(32)
	if err != nil {
		t.Fatal(err)
	}
	b, err := newSecret(32)
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != 43 || a == b || len(secretHash(a)) != 64 {
		t.Fatal("invalid random identifier")
	}
	for _, id := range []string{"acme.example", "publisher.plugin-name"} {
		if !validPluginID(id) {
			t.Error("rejected", id)
		}
	}
	for _, id := range []string{"acme-example", "Acme.example", "acme..example", "acme.example.", "acme/other"} {
		if validPluginID(id) {
			t.Error("accepted", id)
		}
	}
	for _, v := range []string{"1.0.0", "2.0.0-rc.1+build.2"} {
		if !validVersion(v) {
			t.Error("rejected", v)
		}
	}
	for _, v := range []string{"v1.0.0", "1.0", "01.0.0", "not-semver"} {
		if validVersion(v) {
			t.Error("accepted", v)
		}
	}
}
