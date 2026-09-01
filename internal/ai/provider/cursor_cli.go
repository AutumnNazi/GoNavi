package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/logger"
)

var cursorLookPath = lookupLocalCLICommand
var cursorCommandContext = exec.CommandContext
var cursorCLIAuthCheck = CheckCursorCLIAuth
var cursorCLIRequestTimeout = 120 * time.Second
var cursorCLIAuthTimeout = 10 * time.Second

const cursorCLIMaxOutputBytes = 8 * 1024 * 1024

// These project permissions constrain agent tools, not Cursor's trusted native
// runtime. User/team/enterprise hooks and policies remain in force. Cursor does
// not expose a documented equivalent of Codex's hook/config isolation flags.
const cursorCLIProjectConfig = `{"permissions":{"allow":[],"deny":["Shell(*)","Read(**)","Read(/**)","Write(**)","Write(/**)","WebFetch(*)","Mcp(*:*)"]}}`

var cursorCLIANSI = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]`)
var cursorCLIModelID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,255}$`)

// CursorCLIProvider reuses local Cursor sign-in for text responses. It is
// separate from CursorAgentProvider, which uses the cloud API and an API key.
type CursorCLIProvider struct {
	config ai.ProviderConfig
}

func NewCursorCLIProvider(config ai.ProviderConfig) (Provider, error) {
	if !strings.EqualFold(strings.TrimSpace(config.AuthMode), "local-cli") {
		return nil, fmt.Errorf("Cursor CLI provider requires local-cli authentication")
	}
	return &CursorCLIProvider{config: config}, nil
}

func (p *CursorCLIProvider) Name() string { return "CursorCLI" }

func (p *CursorCLIProvider) Validate() error {
	_, err := resolveCursorCLICommand(runtime.GOOS, cursorLookPath)
	return err
}

func resolveCursorCLICommand(goos string, lookPath func(string) (string, error)) (string, error) {
	// "agent" may belong to another vendor, and "cursor" launches the editor.
	// Never use either as an implicit fallback for this provider.
	candidates := []string{"cursor-agent"}
	if goos == "windows" {
		candidates = []string{"cursor-agent.exe", "cursor-agent.cmd", "cursor-agent"}
	}
	for _, candidate := range candidates {
		if command, err := lookPath(candidate); err == nil {
			return command, nil
		}
	}
	return "", fmt.Errorf("cursor-agent command was not found; install Cursor CLI and add cursor-agent to PATH")
}

// CheckCursorCLIAuth checks local sign-in only. Cursor status can exit zero
// even when signed out, and a saved login does not verify model entitlement.
func CheckCursorCLIAuth(ctx context.Context) error {
	output, err := runCursorCLICommand(ctx, []string{"status", "--format", "json"}, "", cursorCLIAuthTimeout, 1024*1024)
	if err != nil {
		return fmt.Errorf("Cursor CLI login check failed: %w", err)
	}
	var status struct {
		Status          string `json:"status"`
		IsAuthenticated bool   `json:"isAuthenticated"`
	}
	if err := json.Unmarshal(output, &status); err != nil {
		return fmt.Errorf("Cursor CLI returned an unrecognized login status; check cursor-agent status locally")
	}
	if status.Status != "authenticated" || !status.IsAuthenticated {
		return fmt.Errorf("Cursor CLI is not signed in; run cursor-agent login locally")
	}
	return nil
}

func discoverCursorCLIModels(ctx context.Context) ([]string, error) {
	output, err := runCursorCLICommand(ctx, []string{"models"}, "", modelDiscoveryTimeout, 1024*1024)
	if err != nil {
		return nil, fmt.Errorf("Cursor CLI model discovery failed: %w", err)
	}
	return parseCursorCLIModels(string(output))
}

func parseCursorCLIModels(output string) ([]string, error) {
	text := cursorCLIANSI.ReplaceAllString(output, "")
	for _, marker := range []string{"not logged in", "not authenticated", "unauthorized", "authentication required", "cursor-agent login", "no models available"} {
		if strings.Contains(strings.ToLower(text), marker) {
			return nil, fmt.Errorf("Cursor CLI did not return available models; check local sign-in or enter a model manually")
		}
	}
	models := make([]string, 0)
	seen := make(map[string]bool)
	inList := false
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(raw)
		if strings.EqualFold(line, "Available models") {
			inList = true
			continue
		}
		if !inList || line == "" {
			continue
		}
		if strings.HasPrefix(strings.ToLower(line), "tip:") {
			break
		}
		// Cursor prints "id - Display Name (current, default)", without
		// bullets. Do not reuse Grok's bullet parser or accept arbitrary text.
		model, _, _ := strings.Cut(line, " - ")
		model, _, _ = strings.Cut(model, " (")
		if !cursorCLIModelID.MatchString(model) {
			return nil, fmt.Errorf("Cursor CLI model list has an unrecognized format; enter a model manually")
		}
		if !seen[model] {
			seen[model] = true
			models = append(models, model)
		}
	}
	if len(models) == 0 {
		return nil, fmt.Errorf("Cursor CLI returned no model candidates; check local sign-in or enter a model manually")
	}
	return models, nil
}

func (p *CursorCLIProvider) Chat(ctx context.Context, req ai.ChatRequest) (response *ai.ChatResponse, requestErr error) {
	args, err := buildCursorCLIArgs(p.config)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, cursorCLIRequestTimeout)
	defer cancel()
	if err := cursorCLIAuthCheck(ctx); err != nil {
		return nil, err
	}
	prompt := buildPrompt(req.Messages)
	requestLog := logAIUpstreamRequestStart(p.Name(), "CLI", "cursor://cli", map[string]any{
		"model":        strings.TrimSpace(p.config.Model),
		"messageCount": len(req.Messages),
		"promptChars":  len(prompt),
		"mode":         "ask",
		"nativeHooks":  "retained",
	})
	defer func() { logAIUpstreamRequestFinish(requestLog, 0, requestErr) }()
	output, err := runCursorCLICommand(ctx, args, prompt, cursorCLIRequestTimeout, cursorCLIMaxOutputBytes)
	if err != nil {
		return nil, err
	}
	content, err := parseCursorCLIResponse(output)
	if err != nil {
		return nil, err
	}
	return &ai.ChatResponse{Content: content}, nil
}

// The CLI's terminal JSON is buffered. Do not synthesize token usage or claim
// incremental model streaming before Cursor has completed successfully.
func (p *CursorCLIProvider) ChatStream(ctx context.Context, req ai.ChatRequest, callback func(ai.StreamChunk)) error {
	response, err := p.Chat(ctx, req)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return context.Canceled
		}
		callback(ai.StreamChunk{Error: err.Error(), Done: true})
		return nil
	}
	callback(ai.StreamChunk{Content: response.Content})
	callback(ai.StreamChunk{Done: true})
	return nil
}

func buildCursorCLIArgs(config ai.ProviderConfig) ([]string, error) {
	capability, ok := LookupCLICapability("cursor-cli")
	if !ok {
		return nil, fmt.Errorf("Cursor CLI capability is not registered")
	}
	if _, err := capability.NormalizeEffort(config.Effort); err != nil {
		return nil, err
	}
	args := []string{"--print", "--output-format", "json", "--mode", "ask", "--sandbox", "enabled", "--trust"}
	if model := strings.TrimSpace(config.Model); model != "" {
		args = append(args, "--model", model)
	}
	return args, nil
}

func parseCursorCLIResponse(output []byte) (string, error) {
	var result struct {
		Type    string `json:"type"`
		Subtype string `json:"subtype"`
		IsError *bool  `json:"is_error"`
		Result  string `json:"result"`
	}
	if err := json.Unmarshal(output, &result); err != nil {
		return "", fmt.Errorf("Cursor CLI returned invalid response JSON")
	}
	if result.Type != "result" || result.Subtype != "success" || result.IsError == nil || *result.IsError {
		return "", fmt.Errorf("Cursor CLI did not return a successful model response")
	}
	if strings.TrimSpace(result.Result) == "" {
		return "", fmt.Errorf("Cursor CLI returned an empty model response")
	}
	return strings.TrimSpace(result.Result), nil
}

func buildCursorCLIEnv(env []string, dataDir string) []string {
	// Keep HOME and native policy/config resolution for existing login and
	// managed policies. Only request data is temporary; hooks are not disabled.
	env = removeEnvKeys(env, "CURSOR_API_KEY", "CURSOR_AUTH_TOKEN", "CURSOR_STATSIG_OVERRIDES", "CURSOR_DATA_DIR", "NO_COLOR", "FORCE_COLOR")
	env = append(env, "CURSOR_DATA_DIR="+dataDir, "NO_COLOR=1", "FORCE_COLOR=0")
	return env
}

func runCursorCLICommand(ctx context.Context, args []string, prompt string, timeout time.Duration, outputLimit int) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	command, err := resolveCursorCLICommand(runtime.GOOS, cursorLookPath)
	if err != nil {
		return nil, err
	}
	workspace, err := os.MkdirTemp("", "gonavi-cursor-")
	if err != nil {
		return nil, fmt.Errorf("create Cursor CLI temporary workspace: %w", err)
	}
	defer func() {
		if err := os.RemoveAll(workspace); err != nil {
			logger.Warnf("CursorCLI temporary workspace cleanup failed: %v", err)
		}
	}()
	resolvedWorkspace, err := filepath.EvalSymlinks(workspace)
	if err != nil {
		return nil, fmt.Errorf("resolve Cursor CLI temporary workspace: %w", err)
	}
	workspace = resolvedWorkspace
	if err := os.Mkdir(filepath.Join(workspace, ".cursor"), 0o700); err != nil {
		return nil, fmt.Errorf("prepare Cursor CLI permissions: %w", err)
	}
	if err := os.WriteFile(filepath.Join(workspace, ".cursor", "cli.json"), []byte(cursorCLIProjectConfig), 0o600); err != nil {
		return nil, fmt.Errorf("write Cursor CLI temporary permissions: %w", err)
	}
	// --trust refers exclusively to our newly-created workspace, never the
	// user's project. No user CLI configuration or login file is rewritten.
	commandArgs := append([]string{"--workspace", workspace}, args...)
	cmd := cursorCommandContext(ctx, command, commandArgs...)
	configureClaudeCLICommand(cmd) // Hide the console window on Windows.
	cmd.Dir = workspace
	cmd.Env = EnrichCLICommandPATH(buildCursorCLIEnv(cmd.Environ(), filepath.Join(workspace, "data")), command)
	cmd.Stdin = strings.NewReader(prompt)
	cmd.WaitDelay = time.Second
	stdout := &cursorCLILimitedBuffer{limit: outputLimit, cancel: cancel}
	stderr := &cursorCLILimitedBuffer{limit: 64 * 1024, cancel: cancel}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	runErr := cmd.Run()
	if stdout.exceeded || stderr.exceeded {
		return nil, fmt.Errorf("Cursor CLI exceeded the output limit")
	}
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("Cursor CLI request stopped: %w", err)
	}
	if runErr != nil {
		var exitErr *exec.ExitError
		if errors.As(runErr, &exitErr) {
			return nil, fmt.Errorf("Cursor CLI exited with code %d; check local sign-in, model and CLI version", exitErr.ExitCode())
		}
		// Never surface raw output: it can contain prompts, account data or keys.
		return nil, fmt.Errorf("Cursor CLI could not complete; check the local CLI installation")
	}
	return stdout.buffer.Bytes(), nil
}

type cursorCLILimitedBuffer struct {
	buffer   bytes.Buffer
	limit    int
	exceeded bool
	cancel   context.CancelFunc
}

func (b *cursorCLILimitedBuffer) Write(data []byte) (int, error) {
	size := len(data)
	remaining := b.limit - b.buffer.Len()
	if size > remaining {
		data = data[:remaining]
		if !b.exceeded {
			b.exceeded = true
			b.cancel()
		}
	}
	_, _ = b.buffer.Write(data)
	return size, nil
}
