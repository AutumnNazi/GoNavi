package mcpserver

import (
	"bytes"
	"strings"
	"testing"
)

func TestParseRemoteMCPClientConfigOptionsUsesEnvAndFlags(t *testing.T) {
	t.Setenv("GONAVI_MCP_PUBLIC_URL", "https://agent.example.com/mcp")
	t.Setenv("GONAVI_MCP_HTTP_TOKEN", "env-token")
	t.Setenv("GONAVI_MCP_HTTP_ADDR", "127.0.0.1:9100")
	t.Setenv("GONAVI_MCP_HTTP_PATH", "/env-mcp")

	options, err := ParseRemoteMCPClientConfigOptions([]string{
		"--client", "hermans",
		"--path", "mcp",
		"--token", "flag-token",
	})
	if err != nil {
		t.Fatalf("ParseRemoteMCPClientConfigOptions returned error: %v", err)
	}
	if options.DisplayName != "Hermans" {
		t.Fatalf("expected Hermans display name, got %q", options.DisplayName)
	}
	if options.URL != "https://agent.example.com/mcp" {
		t.Fatalf("expected env url, got %q", options.URL)
	}
	if options.Token != "flag-token" {
		t.Fatalf("expected flag token, got %q", options.Token)
	}
	if options.Path != "/mcp" {
		t.Fatalf("expected normalized path, got %q", options.Path)
	}
	if !options.SchemaOnly {
		t.Fatal("expected remote config to default to schema-only")
	}
}

func TestRenderRemoteMCPClientConfigShowsCloudAndWindowsCommands(t *testing.T) {
	text, err := RenderRemoteMCPClientConfig(RemoteMCPClientConfigOptions{
		Client:            "openclaw",
		URL:               "https://openclaw.example.com/mcp",
		Token:             "secret-token",
		LocalAddr:         "127.0.0.1:8765",
		Path:              "/mcp",
		GoNaviCommand:     `C:\Program Files\GoNavi\GoNavi.exe`,
		StandaloneCommand: "gonavi-mcp-server",
		SchemaOnly:        true,
	})
	if err != nil {
		t.Fatalf("RenderRemoteMCPClientConfig returned error: %v", err)
	}

	for _, want := range []string{
		"GoNavi MCP 远程接入配置 - OpenClaw",
		`"type": "streamable-http"`,
		`"url": "https://openclaw.example.com/mcp"`,
		`"Authorization": "Bearer secret-token"`,
		`"C:\Program Files\GoNavi\GoNavi.exe" mcp-server http --addr 127.0.0.1:8765 --path /mcp --token secret-token --schema-only`,
		`gonavi-mcp-server http --addr 127.0.0.1:8765 --path /mcp --token secret-token --schema-only`,
		"数据库连接、账号和密码继续保存在 Windows GoNavi",
		"默认 schema-only 模式不会注册 execute_sql",
		"调用 execute_sql 即视为确认",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected rendered config to contain %q, got:\n%s", want, text)
		}
	}
	if strings.Contains(text, "gonavi-mcp-server mcp-server http") {
		t.Fatalf("standalone command must not include app-only mcp-server subcommand, got:\n%s", text)
	}
}

func TestRenderRemoteMCPClientConfigCanExposeSQLWhenExplicitlyRequested(t *testing.T) {
	text, err := RenderRemoteMCPClientConfig(RemoteMCPClientConfigOptions{
		Client:     "openclaw",
		URL:        "https://openclaw.example.com/mcp",
		Token:      "secret-token",
		SchemaOnly: false,
	})
	if err != nil {
		t.Fatalf("RenderRemoteMCPClientConfig returned error: %v", err)
	}
	if strings.Contains(text, "http --addr 127.0.0.1:8765 --path /mcp --token secret-token --schema-only") {
		t.Fatalf("expected launch commands to omit schema-only when disabled, got:\n%s", text)
	}
}

func TestWriteRemoteMCPClientConfigWritesRenderedText(t *testing.T) {
	var buffer bytes.Buffer
	err := WriteRemoteMCPClientConfig(&buffer, []string{
		"--client", "openclaw",
		"--url", "https://example.com/mcp",
		"--token", "token-1",
	})
	if err != nil {
		t.Fatalf("WriteRemoteMCPClientConfig returned error: %v", err)
	}
	if !strings.Contains(buffer.String(), "https://example.com/mcp") {
		t.Fatalf("expected written config to contain public url, got %s", buffer.String())
	}
}
