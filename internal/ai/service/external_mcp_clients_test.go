package aiservice

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"GoNavi-Wails/shared/i18n"
)

type additionalMCPClientConfigPaths struct {
	ZCode           string
	DeepSeekHarness string
	KimiCode        string
	GrokBuild       string
}

func isolateAdditionalMCPClientConfigs(t *testing.T) additionalMCPClientConfigPaths {
	t.Helper()
	originalZCodeConfigPathFunc := zCodeConfigPathFunc
	originalDeepSeekHarnessConfigPathFunc := deepSeekHarnessConfigPathFunc
	originalKimiCodeConfigPathFunc := kimiCodeConfigPathFunc
	originalGrokBuildConfigPathFunc := grokBuildConfigPathFunc

	tempDir := t.TempDir()
	paths := additionalMCPClientConfigPaths{
		ZCode:           filepath.Join(tempDir, "zcode", "config.json"),
		DeepSeekHarness: filepath.Join(tempDir, "deepseek-harness", "cordis.patch.yml"),
		KimiCode:        filepath.Join(tempDir, "kimi", "mcp.json"),
		GrokBuild:       filepath.Join(tempDir, "grok", "config.toml"),
	}
	zCodeConfigPathFunc = func() (string, error) { return paths.ZCode, nil }
	deepSeekHarnessConfigPathFunc = func() (string, error) { return paths.DeepSeekHarness, nil }
	kimiCodeConfigPathFunc = func() (string, error) { return paths.KimiCode, nil }
	grokBuildConfigPathFunc = func() (string, error) { return paths.GrokBuild, nil }
	t.Cleanup(func() {
		zCodeConfigPathFunc = originalZCodeConfigPathFunc
		deepSeekHarnessConfigPathFunc = originalDeepSeekHarnessConfigPathFunc
		kimiCodeConfigPathFunc = originalKimiCodeConfigPathFunc
		grokBuildConfigPathFunc = originalGrokBuildConfigPathFunc
	})
	return paths
}

func isolateAdditionalMCPClientExecutable(t *testing.T) string {
	t.Helper()
	originalExecutablePathFunc := localMCPExecutablePathFunc
	executablePath := filepath.Join(t.TempDir(), "GoNavi.exe")
	if err := os.WriteFile(executablePath, []byte("gonavi"), 0o755); err != nil {
		t.Fatalf("WriteFile executable returned error: %v", err)
	}
	localMCPExecutablePathFunc = func() (string, error) { return executablePath, nil }
	t.Cleanup(func() { localMCPExecutablePathFunc = originalExecutablePathFunc })
	return executablePath
}

func mockLocalMCPClientCommandsDetected(t *testing.T) {
	t.Helper()
	originalCLIPathFunc := localCLICommandPathFunc
	commandRoot := t.TempDir()
	localCLICommandPathFunc = func(command string) (string, error) {
		return filepath.Join(commandRoot, strings.TrimSpace(command)+".cmd"), nil
	}
	t.Cleanup(func() { localCLICommandPathFunc = originalCLIPathFunc })
}

func TestLocalMCPClientInstallersRejectUndetectedClientsWithoutWritingConfig(t *testing.T) {
	additionalPaths := isolateAdditionalMCPClientConfigs(t)
	openCodePath := isolateOpenCodeMCPConfig(t)
	originalClaudeConfigPathFunc := claudeCodeConfigPathFunc
	originalCodexConfigPathFunc := codexConfigPathFunc
	originalCLIPathFunc := localCLICommandPathFunc
	t.Cleanup(func() {
		claudeCodeConfigPathFunc = originalClaudeConfigPathFunc
		codexConfigPathFunc = originalCodexConfigPathFunc
		localCLICommandPathFunc = originalCLIPathFunc
	})

	configRoot := t.TempDir()
	claudePath := filepath.Join(configRoot, "claude", "config.json")
	codexPath := filepath.Join(configRoot, "codex", "config.toml")
	claudeCodeConfigPathFunc = func() (string, error) { return claudePath, nil }
	codexConfigPathFunc = func() (string, error) { return codexPath, nil }
	localCLICommandPathFunc = func(string) (string, error) { return "", errors.New("not found") }
	isolateAdditionalMCPClientExecutable(t)

	service := NewService()
	service.AISetLanguage(string(i18n.LanguageEnUS))
	installers := []struct {
		name string
		path string
		run  func() error
	}{
		{name: "Claude Code", path: claudePath, run: func() error { _, err := service.AIInstallClaudeCodeMCP(); return err }},
		{name: "Codex", path: codexPath, run: func() error { _, err := service.AIInstallCodexMCP(); return err }},
		{name: "OpenCode", path: openCodePath, run: func() error { _, err := service.AIInstallOpenCodeMCP(); return err }},
		{name: "ZCode", path: additionalPaths.ZCode, run: func() error { _, err := service.AIInstallZCodeMCP(); return err }},
		{name: "DeepSeek Harness", path: additionalPaths.DeepSeekHarness, run: func() error { _, err := service.AIInstallDeepSeekHarnessMCP(); return err }},
		{name: "Kimi Code", path: additionalPaths.KimiCode, run: func() error { _, err := service.AIInstallKimiMCP(); return err }},
		{name: "Grok Build", path: additionalPaths.GrokBuild, run: func() error { _, err := service.AIInstallGrokBuildMCP(); return err }},
	}

	for _, installer := range installers {
		t.Run(installer.name, func(t *testing.T) {
			if err := installer.run(); err == nil {
				t.Fatalf("expected %s install to reject an undetected client", installer.name)
			} else if !strings.Contains(err.Error(), "was not detected") {
				t.Fatalf("expected %s install error to explain the missing client, got %q", installer.name, err)
			}
			if _, err := os.Stat(installer.path); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("%s config should not be written when the client is undetected, stat error = %v", installer.name, err)
			}
		})
	}
}

func TestDeepSeekHarnessStatusDoesNotReportConnectedWhenClientCommandIsMissing(t *testing.T) {
	paths := isolateAdditionalMCPClientConfigs(t)
	executablePath := isolateAdditionalMCPClientExecutable(t)
	originalCLIPathFunc := localCLICommandPathFunc
	localCLICommandPathFunc = func(string) (string, error) { return "", errors.New("not found") }
	t.Cleanup(func() { localCLICommandPathFunc = originalCLIPathFunc })

	service := NewService()
	service.AISetLanguage(string(i18n.LanguageEnUS))
	if err := upsertDeepSeekHarnessMCPServerConfig(paths.DeepSeekHarness, executablePath, []string{"mcp-server"}, service.serviceText); err != nil {
		t.Fatalf("upsertDeepSeekHarnessMCPServerConfig returned error: %v", err)
	}

	status := inspectDeepSeekHarnessMCPInstallStatus(executablePath, []string{"mcp-server"}, nil, service.serviceText)
	if !status.Installed || status.Command != executablePath {
		t.Fatalf("expected the existing DeepSeek Harness config to be reported, got %#v", status)
	}
	if status.ClientDetected {
		t.Fatalf("expected DeepSeek Harness CLI detection to remain false, got %#v", status)
	}
	if status.MatchesCurrent {
		t.Fatalf("an orphaned DeepSeek Harness config must not be reported as connected, got %#v", status)
	}
	if !strings.Contains(status.Message, "was not detected") {
		t.Fatalf("expected the missing-client explanation, got %q", status.Message)
	}
}

func TestAdditionalMCPClientInstallersWriteCurrentUserConfigs(t *testing.T) {
	paths := isolateAdditionalMCPClientConfigs(t)
	executablePath := isolateAdditionalMCPClientExecutable(t)
	mockLocalMCPClientCommandsDetected(t)
	service := NewService()
	service.AISetLanguage(string(i18n.LanguageEnUS))

	zCodeInitial := map[string]any{
		"theme": "dark",
		"mcp": map[string]any{
			"servers": map[string]any{
				"memory": map[string]any{"command": "memory-server"},
			},
		},
	}
	zCodeData, err := json.MarshalIndent(zCodeInitial, "", "  ")
	if err != nil {
		t.Fatalf("MarshalIndent ZCode config returned error: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(paths.ZCode), 0o755); err != nil {
		t.Fatalf("MkdirAll ZCode dir returned error: %v", err)
	}
	if err := os.WriteFile(paths.ZCode, append(zCodeData, '\n'), 0o644); err != nil {
		t.Fatalf("WriteFile ZCode config returned error: %v", err)
	}

	kimiInitial := map[string]any{
		"mcpServers": map[string]any{
			"memory": map[string]any{"command": "memory-server"},
		},
	}
	kimiData, err := json.MarshalIndent(kimiInitial, "", "  ")
	if err != nil {
		t.Fatalf("MarshalIndent Kimi config returned error: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(paths.KimiCode), 0o755); err != nil {
		t.Fatalf("MkdirAll Kimi dir returned error: %v", err)
	}
	if err := os.WriteFile(paths.KimiCode, append(kimiData, '\n'), 0o644); err != nil {
		t.Fatalf("WriteFile Kimi config returned error: %v", err)
	}

	if err := os.MkdirAll(filepath.Dir(paths.GrokBuild), 0o755); err != nil {
		t.Fatalf("MkdirAll Grok dir returned error: %v", err)
	}
	grokInitial := strings.Join([]string{
		`model = "grok-4.6"`,
		``,
		`[mcp_servers.memory]`,
		`command = "memory-server"`,
		``,
	}, "\n")
	if err := os.WriteFile(paths.GrokBuild, []byte(grokInitial), 0o644); err != nil {
		t.Fatalf("WriteFile Grok config returned error: %v", err)
	}

	if err := os.MkdirAll(filepath.Dir(paths.DeepSeekHarness), 0o755); err != nil {
		t.Fatalf("MkdirAll DeepSeek Harness dir returned error: %v", err)
	}
	deepSeekInitial := strings.Join([]string{
		"# Existing Harness preferences must survive the GoNavi entry.",
		"- insert:",
		"    - id: existing-plugin",
		"      name: example-plugin",
		"      config:",
		"        enabled: !!js process.env.EXAMPLE_ENABLED",
		"- insert:",
		"    - id: gonavi-mcp",
		"      name: '@deepseek-ai/dsh-mcp-client'",
		"      config:",
		"        serverName: gonavi",
		"        transport: stdio",
		"        command: old-gonavi",
		"        args: [mcp-server]",
		"        reconnect: 3",
		"",
	}, "\n")
	if err := os.WriteFile(paths.DeepSeekHarness, []byte(deepSeekInitial), 0o644); err != nil {
		t.Fatalf("WriteFile DeepSeek Harness config returned error: %v", err)
	}

	installers := []struct {
		name string
		path string
		run  func() error
	}{
		{name: "ZCode", path: paths.ZCode, run: func() error { _, err := service.AIInstallZCodeMCP(); return err }},
		{name: "DeepSeek Harness", path: paths.DeepSeekHarness, run: func() error { _, err := service.AIInstallDeepSeekHarnessMCP(); return err }},
		{name: "Kimi Code", path: paths.KimiCode, run: func() error { _, err := service.AIInstallKimiMCP(); return err }},
		{name: "Grok Build", path: paths.GrokBuild, run: func() error { _, err := service.AIInstallGrokBuildMCP(); return err }},
	}
	for _, installer := range installers {
		if err := installer.run(); err != nil {
			t.Fatalf("%s installer returned error: %v", installer.name, err)
		}
		if _, err := os.Stat(installer.path); err != nil {
			t.Fatalf("%s config was not written: %v", installer.name, err)
		}
	}

	zCodeConfig, found, err := readExternalJSONMCPServerConfig(paths.ZCode, gonaviMCPServerID, zCodeMCPClientSpec, service.serviceText)
	if err != nil || !found {
		t.Fatalf("read ZCode GoNavi MCP config = (%#v, %t, %v)", zCodeConfig, found, err)
	}
	if !zCodeConfig.Enabled || zCodeConfig.Command != executablePath || !reflect.DeepEqual(zCodeConfig.Args, []string{"mcp-server"}) {
		t.Fatalf("unexpected ZCode config: %#v", zCodeConfig)
	}
	zCodeSaved, err := os.ReadFile(paths.ZCode)
	if err != nil {
		t.Fatalf("ReadFile ZCode config returned error: %v", err)
	}
	if !strings.Contains(string(zCodeSaved), `"theme": "dark"`) || !strings.Contains(string(zCodeSaved), `"memory"`) {
		t.Fatalf("expected unrelated ZCode settings to remain, got %s", zCodeSaved)
	}

	kimiConfig, found, err := readExternalJSONMCPServerConfig(paths.KimiCode, gonaviMCPServerID, kimiCodeMCPClientSpec, service.serviceText)
	if err != nil || !found {
		t.Fatalf("read Kimi GoNavi MCP config = (%#v, %t, %v)", kimiConfig, found, err)
	}
	if !kimiConfig.Enabled || kimiConfig.Command != executablePath || !reflect.DeepEqual(kimiConfig.Args, []string{"mcp-server"}) {
		t.Fatalf("unexpected Kimi config: %#v", kimiConfig)
	}

	grokConfig, found, err := readGrokBuildMCPServerConfig(paths.GrokBuild, gonaviMCPServerID, service.serviceText)
	if err != nil || !found {
		t.Fatalf("read Grok GoNavi MCP config = (%#v, %t, %v)", grokConfig, found, err)
	}
	if grokConfig.Command != executablePath || !reflect.DeepEqual(grokConfig.Args, []string{"mcp-server"}) || grokConfig.StartupTimeoutSec != defaultGrokBuildMCPStartupTimeoutSecond {
		t.Fatalf("unexpected Grok config: %#v", grokConfig)
	}
	grokSaved, err := os.ReadFile(paths.GrokBuild)
	if err != nil {
		t.Fatalf("ReadFile Grok config returned error: %v", err)
	}
	if !strings.Contains(string(grokSaved), `model = "grok-4.6"`) || !strings.Contains(string(grokSaved), `[mcp_servers.memory]`) {
		t.Fatalf("expected unrelated Grok config to remain, got %s", grokSaved)
	}

	deepSeekConfig, found, err := readDeepSeekHarnessMCPServerConfig(paths.DeepSeekHarness, service.serviceText)
	if err != nil || !found {
		t.Fatalf("read DeepSeek Harness GoNavi MCP config = (%#v, %t, %v)", deepSeekConfig, found, err)
	}
	if deepSeekConfig.Command != executablePath || !reflect.DeepEqual(deepSeekConfig.Args, []string{"mcp-server"}) {
		t.Fatalf("unexpected DeepSeek Harness config: %#v", deepSeekConfig)
	}
	deepSeekSaved, err := os.ReadFile(paths.DeepSeekHarness)
	if err != nil {
		t.Fatalf("ReadFile DeepSeek Harness config returned error: %v", err)
	}
	if !strings.Contains(string(deepSeekSaved), "existing-plugin") || !strings.Contains(string(deepSeekSaved), "!!js") || !strings.Contains(string(deepSeekSaved), "reconnect: 3") {
		t.Fatalf("expected unrelated and managed DeepSeek Harness settings to remain intact, got %s", deepSeekSaved)
	}

	if _, err := service.AIInstallDeepSeekHarnessMCP(); err != nil {
		t.Fatalf("repeat DeepSeek Harness install returned error: %v", err)
	}
	deepSeekSaved, err = os.ReadFile(paths.DeepSeekHarness)
	if err != nil {
		t.Fatalf("ReadFile repeated DeepSeek Harness config returned error: %v", err)
	}
	if strings.Count(string(deepSeekSaved), "id: gonavi-mcp") != 1 {
		t.Fatalf("expected one DeepSeek Harness GoNavi entry, got %s", deepSeekSaved)
	}
}

func TestAdditionalMCPClientStatusesReportCurrentInstallations(t *testing.T) {
	isolateAdditionalMCPClientConfigs(t)
	executablePath := isolateAdditionalMCPClientExecutable(t)
	mockLocalMCPClientCommandsDetected(t)
	service := NewService()
	service.AISetLanguage(string(i18n.LanguageEnUS))

	if _, err := service.AIInstallZCodeMCP(); err != nil {
		t.Fatalf("AIInstallZCodeMCP returned error: %v", err)
	}
	if _, err := service.AIInstallDeepSeekHarnessMCP(); err != nil {
		t.Fatalf("AIInstallDeepSeekHarnessMCP returned error: %v", err)
	}
	if _, err := service.AIInstallKimiMCP(); err != nil {
		t.Fatalf("AIInstallKimiMCP returned error: %v", err)
	}
	if _, err := service.AIInstallGrokBuildMCP(); err != nil {
		t.Fatalf("AIInstallGrokBuildMCP returned error: %v", err)
	}

	statuses := service.AIGetMCPClientInstallStatuses()
	if len(statuses) != 9 {
		t.Fatalf("expected 9 MCP client statuses, got %d", len(statuses))
	}
	byClient := make(map[string]bool, len(statuses))
	for _, status := range statuses {
		byClient[status.Client] = true
		if status.Client == "zcode" || status.Client == "deepseek-harness" || status.Client == "kimi" || status.Client == "grok-build" {
			if !status.Installed || !status.MatchesCurrent || status.Command != executablePath || !reflect.DeepEqual(status.Args, []string{"mcp-server"}) {
				t.Fatalf("unexpected %s status: %#v", status.Client, status)
			}
			if status.InstallMode != "auto" {
				t.Fatalf("expected %s auto install mode, got %#v", status.Client, status)
			}
		}
	}
	for _, client := range []string{"zcode", "deepseek-harness", "kimi", "grok-build"} {
		if !byClient[client] {
			t.Fatalf("missing %s status: %#v", client, statuses)
		}
	}

}

func TestResolveKimiCodeConfigPathHonorsKimiCodeHome(t *testing.T) {
	root := filepath.Join(t.TempDir(), "kimi-home")
	t.Setenv("KIMI_CODE_HOME", root)
	path, err := resolveKimiCodeConfigPath()
	if err != nil {
		t.Fatalf("resolveKimiCodeConfigPath returned error: %v", err)
	}
	if want := filepath.Join(root, "mcp.json"); path != want {
		t.Fatalf("Kimi config path = %q, want %q", path, want)
	}
}
