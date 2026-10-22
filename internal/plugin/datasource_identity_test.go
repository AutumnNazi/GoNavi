package plugin

import (
	"strings"
	"testing"
)

func TestDataSourceTypeRoundTrip(t *testing.T) {
	for _, dialect := range []string{"mysql", "postgres", "sqlite"} {
		t.Run(dialect, func(t *testing.T) {
			source := DataSource{ID: "fixture", Dialect: dialect}
			identity := DataSourceType("sdk.examples.readonly", source)
			if want := "plugin:sdk.examples.readonly:fixture:" + dialect; identity != want {
				t.Fatalf("identity=%q; want %q", identity, want)
			}
			pluginID, sourceID, parsedDialect, ok := ParseDataSourceType(identity)
			if !ok || pluginID != "sdk.examples.readonly" || sourceID != source.ID || parsedDialect != dialect {
				t.Fatalf("parsed=%q/%q/%q/%v", pluginID, sourceID, parsedDialect, ok)
			}
		})
	}
	// Built-in names remain safely namespaced, not aliases to a built-in factory.
	identity := DataSourceType("example.source", DataSource{ID: "mysql", Dialect: "mysql"})
	if identity != "plugin:example.source:mysql:mysql" {
		t.Fatalf("built-in source name lost namespace: %q", identity)
	}
}

func TestDataSourceIdentityValidation(t *testing.T) {
	cases := []struct{ name, pluginID, sourceID, dialect string }{
		{"missing publisher", "example", "fixture", "sqlite"},
		{"publisher case", "Example.source", "fixture", "sqlite"},
		{"publisher traversal", "../example.source", "fixture", "sqlite"},
		{"publisher colon", "example.source:other", "fixture", "sqlite"},
		{"publisher empty segment", "example..source", "fixture", "sqlite"},
		{"publisher size", "a." + strings.Repeat("b", 127), "fixture", "sqlite"},
		{"source empty", "example.source", "", "sqlite"},
		{"source case", "example.source", "Fixture", "sqlite"},
		{"source starts number", "example.source", "1fixture", "sqlite"},
		{"source starts dot", "example.source", ".fixture", "sqlite"},
		{"source starts hyphen", "example.source", "-fixture", "sqlite"},
		{"source colon", "example.source", "fixture:other", "sqlite"},
		{"source path", "example.source", "fixture/path", "sqlite"},
		{"source backslash", "example.source", "fixture\\path", "sqlite"},
		{"source unicode", "example.source", "fïxture", "sqlite"},
		{"source nul", "example.source", "fixture\x00", "sqlite"},
		{"source whitespace", "example.source", "fixture ", "sqlite"},
		{"source length", "example.source", strings.Repeat("a", 65), "sqlite"},
		{"unknown dialect", "example.source", "fixture", "oracle"},
		{"dialect alias", "example.source", "fixture", "postgresql"},
		{"dialect case", "example.source", "fixture", "SQLite"},
		{"dialect trailing data", "example.source", "fixture", "sqlite:extra"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := DataSourceType(test.pluginID, DataSource{ID: test.sourceID, Dialect: test.dialect}); got != "" {
				t.Fatalf("invalid identity generated %q", got)
			}
			assertInvalidDataSourceType(t, "plugin:"+test.pluginID+":"+test.sourceID+":"+test.dialect)
		})
	}
	for _, value := range []string{"", "mysql", "plugin:mysql", "plugin:example.source:fixture", "plugin:example.source:fixture:sqlite:extra", "Plugin:example.source:fixture:sqlite", " plugin:example.source:fixture:sqlite", "plugin:example.source:fixture:sqlite\n", strings.Repeat(":", 1024)} {
		assertInvalidDataSourceType(t, value)
	}
}

func assertInvalidDataSourceType(t *testing.T, value string) {
	t.Helper()
	pluginID, sourceID, dialect, ok := ParseDataSourceType(value)
	if ok || pluginID != "" || sourceID != "" || dialect != "" {
		t.Fatalf("invalid value %q parsed as %q/%q/%q/%v", value, pluginID, sourceID, dialect, ok)
	}
}

func TestDataSourceIdentityBoundary(t *testing.T) {
	pluginID := "a." + strings.Repeat("b", 126)
	source := DataSource{ID: "a" + strings.Repeat("b", 63), Dialect: "postgres"}
	identity := DataSourceType(pluginID, source)
	if len(identity) != maxDataSourceTypeBytes {
		t.Fatalf("boundary type length=%d; want %d", len(identity), maxDataSourceTypeBytes)
	}
	if _, _, _, ok := ParseDataSourceType(identity); !ok {
		t.Fatal("valid boundary identity rejected")
	}
	for _, id := range []string{"a_b.c-d", "a..b", "a-", "a_"} {
		if DataSourceType("example.source", DataSource{ID: id, Dialect: "sqlite"}) == "" {
			t.Fatalf("ID allowed by source grammar rejected: %q", id)
		}
	}
}

func FuzzParseDataSourceType(f *testing.F) {
	for _, value := range []string{"plugin:example.source:fixture:sqlite", "plugin:a.b:source:postgres", "mysql", "plugin:a.b:bad:id:sqlite"} {
		f.Add(value)
	}
	f.Fuzz(func(t *testing.T, value string) {
		pluginID, sourceID, dialect, ok := ParseDataSourceType(value)
		if !ok {
			if pluginID != "" || sourceID != "" || dialect != "" {
				t.Fatal("invalid identity leaked partial components")
			}
			return
		}
		if rebuilt := DataSourceType(pluginID, DataSource{ID: sourceID, Dialect: dialect}); rebuilt != value {
			t.Fatalf("identity normalized from %q to %q", value, rebuilt)
		}
	})
}
