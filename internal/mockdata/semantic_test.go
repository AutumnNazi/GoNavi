package mockdata

import (
	"encoding/json"
	"net"
	"net/mail"
	"slices"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestSemanticGeneratorsProduceValidValues(t *testing.T) {
	kinds := []Kind{
		KindPersonName, KindUsername, KindEmail, KindPhone, KindProvince, KindCity, KindAddress, KindCompany,
		KindURL, KindIPv4, KindText, KindRandomString, KindJSON, KindUUID,
	}
	profiles := ClassifyTable(FamilyPostgres, []connection.ColumnDefinition{{Name: "v", Type: "text", Nullable: "YES"}}, TableKeys{})
	for _, locale := range []string{LocaleZH, LocaleEN} {
		for _, kind := range kinds {
			t.Run(locale+"/"+string(kind), func(t *testing.T) {
				producer, err := NewProducer(Plan{RowCount: 20, Seed: 99, Locale: locale, Columns: []ColumnPlan{
					{Name: "v", Generator: Generator{Kind: kind}},
				}}, profiles, nil)
				if err != nil {
					t.Fatalf("NewProducer: %v", err)
				}
				for _, row := range collect(t, producer) {
					value, _ := row["v"].(string)
					if strings.TrimSpace(value) == "" {
						t.Fatal("empty value")
					}
					checkSemanticValue(t, kind, value)
				}
			})
		}
	}
}

func checkSemanticValue(t *testing.T, kind Kind, value string) {
	t.Helper()
	switch kind {
	case KindEmail:
		_, domain, _ := strings.Cut(value, "@")
		if _, err := mail.ParseAddress(value); err != nil || !slices.Contains(emailDomains, domain) {
			t.Fatalf("bad email %q", value)
		}
	case KindIPv4:
		if ip := net.ParseIP(value); ip == nil || ip.To4() == nil || ip.IsLoopback() {
			t.Fatalf("bad ipv4 %q", value)
		}
	case KindJSON:
		if !json.Valid([]byte(value)) {
			t.Fatalf("bad json %q", value)
		}
	case KindURL:
		if !strings.HasPrefix(value, "https://") || !strings.Contains(value, ".example.com/") {
			t.Fatalf("bad url %q", value)
		}
	}
}
