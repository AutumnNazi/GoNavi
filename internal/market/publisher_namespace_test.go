package market

import (
	"strings"
	"testing"
)

func TestPublisherNamespacePattern(t *testing.T) {
	cases := []struct {
		name      string
		namespace string
		valid     bool
	}{
		{"single segment slug", "acme", true},
		{"reverse domain segments", "com.gonavi", true},
		{"three segments", "dev.gonavi.tools", true},
		{"segment with digits and dashes", "acme-corp2.plugins", true},
		{"uppercase rejected", "Com.gonavi", false},
		{"leading dot rejected", ".gonavi", false},
		{"trailing dot rejected", "gonavi.", false},
		{"double dot rejected", "gonavi..tools", false},
		{"digit-leading segment rejected", "1gonavi.tools", false},
		{"underscore rejected", "go_navi", false},
		{"segment over 63 bytes rejected", "a" + strings.Repeat("b", 63), false},
		{"total over 200 bytes rejected", "a." + strings.Repeat(strings.Repeat("b", 9)+".", 20) + strings.Repeat("b", 9), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := len(c.namespace) <= maxPublisherNamespaceBytes && publisherPattern.MatchString(c.namespace); got != c.valid {
				t.Fatalf("namespace %q valid=%v, want %v", c.namespace, got, c.valid)
			}
		})
	}
}
