package db

import (
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestLooksLikeAzureSQLHost(t *testing.T) {
	t.Parallel()

	tests := []struct {
		host string
		want bool
	}{
		{host: "myserver.database.windows.net", want: true},
		{host: "myserver.database.chinacloudapi.cn", want: true},
		{host: "myserver.sql.azuresynapse.net", want: true},
		{host: "sql.example.com", want: false},
		{host: "127.0.0.1", want: false},
		{host: "", want: false},
	}
	for _, test := range tests {
		if got := looksLikeAzureSQLHost(test.host); got != test.want {
			t.Fatalf("looksLikeAzureSQLHost(%q)=%v, want %v", test.host, got, test.want)
		}
	}
}

func TestResolveSQLServerTLSSettingsForcesEncryptForAzureHosts(t *testing.T) {
	t.Parallel()

	encrypt, trust := resolveSQLServerTLSSettings(connection.ConnectionConfig{
		Host: "myserver.database.windows.net",
	})
	if encrypt != "true" || trust != "true" {
		t.Fatalf("azure without SSL: encrypt=%q trust=%q, want true/true", encrypt, trust)
	}

	encrypt, trust = resolveSQLServerTLSSettings(connection.ConnectionConfig{
		Host:    "myserver.database.windows.net",
		UseSSL:  true,
		SSLMode: "required",
	})
	if encrypt != "true" || trust != "false" {
		t.Fatalf("azure required SSL: encrypt=%q trust=%q, want true/false", encrypt, trust)
	}

	encrypt, trust = resolveSQLServerTLSSettings(connection.ConnectionConfig{
		Host: "127.0.0.1",
	})
	if encrypt != "disable" {
		t.Fatalf("on-prem without SSL: encrypt=%q, want disable", encrypt)
	}
}

func TestAzureSQLHostNameInCertificate(t *testing.T) {
	t.Parallel()

	if got := azureSQLHostNameInCertificate("myserver.database.windows.net"); got != "*.database.windows.net" {
		t.Fatalf("windows.net cert host = %q", got)
	}
	if got := azureSQLHostNameInCertificate("sql.example.com"); got != "" {
		t.Fatalf("non-azure cert host = %q, want empty", got)
	}
}
