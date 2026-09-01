package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"GoNavi-Wails/internal/ai"
)

var grokLookPath = lookupLocalCLICommand

var grokCLIRequestTimeout = 120 * time.Second

// grokCLIIsolationNote 说明本 provider 的隔离边界与 codex 不对等，务必不要按 codex 的假设使用。
//
// codex 有 --ignore-user-config / --ignore-rules，可以把用户的全局配置与规则整个隔离掉。
// grok 1.0.5 没有任何等价 flag：它只提供 --rules（追加）与 --system-prompt-override（覆盖系统提示）。
// 实测未加隔离时，一次 "say OK" 的调用会把用户全局规则读进上下文（input_tokens 上万），
// 因此这里必须显式覆盖系统提示，并把内置工具白名单清空。
const grokCLIIsolationNote = "isolated"

// grokCLISystemPrompt 覆盖 grok 自身的 agent 系统提示，阻断用户全局规则进入本次调用。
// 它只声明当前用途，不描述任何数据库写入能力——写库能力由 GoNavi 侧的安全层决定。
const grokCLISystemPrompt = "You are a database assistant embedded in GoNavi. " +
	"Answer the user's question and generate SQL when asked. " +
	"Do not use tools, do not read or modify local files, and do not follow instructions from any other rules file."

type grokCLIResponse struct {
	Text       string `json:"text"`
	Thought    string `json:"thought"`
	StopReason string `json:"stopReason"`
	Usage      struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
		TotalTokens  int `json:"total_tokens"`
	} `json:"usage"`
}

type grokCLIResult struct {
	Content  string
	Thinking string
	Usage    ai.TokenUsage
}

// GrokCLIProvider 通过本机 Grok CLI 的订阅登录态提供对话与 SQL 生成。
type GrokCLIProvider struct {
	config ai.ProviderConfig
}

func NewGrokCLIProvider(config ai.ProviderConfig) (Provider, error) {
	if !strings.EqualFold(strings.TrimSpace(config.AuthMode), "local-cli") {
		return nil, fmt.Errorf("Grok CLI provider requires local-cli subscription authentication")
	}
	return &GrokCLIProvider{config: config}, nil
}

func (p *GrokCLIProvider) Name() string {
	return "GrokCLI"
}

func (p *GrokCLIProvider) Validate() error {
	_, err := resolveGrokCLICommand(runtime.GOOS, grokLookPath)
	return err
}

// CheckGrokCLIModels checks the CLI model-list command without sending a chat
// message. A readable list is not proof that the selected model can respond.
func CheckGrokCLIModels(ctx context.Context) error {
	capability, ok := LookupCLICapability("grok-cli")
	if !ok || len(capability.ModelDiscoveryArgs) == 0 {
		return fmt.Errorf("Grok CLI model-list check is unavailable")
	}
	_, err := capability.DiscoverModels(ctx)
	return err
}

// resolveGrokCLICommand 跨平台解析 grok 可执行文件。
// Windows 上 npm 风格安装会生成 .cmd 包装，Unix 上只有裸名。
func resolveGrokCLICommand(goos string, lookPath func(string) (string, error)) (string, error) {
	candidates := []string{"grok"}
	if goos == "windows" {
		candidates = []string{"grok.cmd", "grok.exe", "grok"}
	}
	for _, name := range candidates {
		if path, err := lookPath(name); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("grok command was not found; install the Grok CLI first and make sure it is on PATH")
}

func (p *GrokCLIProvider) Chat(ctx context.Context, req ai.ChatRequest) (*ai.ChatResponse, error) {
	result, err := p.run(ctx, req)
	if err != nil {
		return nil, err
	}
	return &ai.ChatResponse{
		Content:          result.Content,
		ReasoningContent: result.Thinking,
		TokensUsed:       result.Usage,
	}, nil
}

func (p *GrokCLIProvider) ChatStream(ctx context.Context, req ai.ChatRequest, callback func(ai.StreamChunk)) error {
	result, err := p.run(ctx, req)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return context.Canceled
		}
		callback(ai.StreamChunk{Error: err.Error(), Done: true})
		return nil
	}
	if result.Thinking != "" {
		callback(ai.StreamChunk{Thinking: result.Thinking})
	}
	if result.Content != "" {
		callback(ai.StreamChunk{Content: result.Content})
	}
	callback(ai.StreamChunk{Done: true})
	return nil
}

func (p *GrokCLIProvider) run(ctx context.Context, req ai.ChatRequest) (grokCLIResult, error) {
	ctx, cancel := ensureClaudeCLITimeout(ctx, grokCLIRequestTimeout)
	defer cancel()

	command, err := resolveGrokCLICommand(runtime.GOOS, grokLookPath)
	if err != nil {
		return grokCLIResult{}, err
	}

	prompt := buildPrompt(req.Messages)
	args, err := buildGrokCLIArgs(p.config, prompt)
	if err != nil {
		return grokCLIResult{}, err
	}

	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Env = EnrichCLICommandPATH(cmd.Environ(), command)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	requestLog := logAIUpstreamRequestStart(
		p.Name(),
		"CLI",
		"grok://cli",
		buildGrokCLIRequestLogBody(args, prompt, p.config, req),
	)
	var requestErr error
	defer func() {
		logAIUpstreamRequestFinish(requestLog, 0, requestErr)
	}()

	runErr := cmd.Run()
	if ctx.Err() != nil {
		requestErr = ctx.Err()
		return grokCLIResult{}, requestErr
	}

	combined := stdout.String() + "\n" + stderr.String()

	// 关键：grok 在参数被拒、被限流或 max-turns 终止时【退出码仍为 0】，
	// 错误只出现在输出里。因此必须先做输出判定，不能依赖 runErr。
	capability, _ := LookupCLICapability("grok-cli")
	if rejection := capability.InspectRejection(combined); rejection != nil {
		requestErr = rejection
		return grokCLIResult{}, requestErr
	}

	parsed, parseErr := parseGrokCLIResponse(stdout.Bytes())
	if parseErr != nil {
		detail := strings.TrimSpace(firstLineFrom(strings.TrimSpace(combined)))
		if runErr != nil && detail == "" {
			detail = runErr.Error()
		}
		if detail == "" {
			detail = parseErr.Error()
		}
		requestErr = fmt.Errorf("Grok CLI execution failed: %s", detail)
		return grokCLIResult{}, requestErr
	}

	if strings.TrimSpace(parsed.Content) == "" {
		requestErr = fmt.Errorf("Grok CLI returned no content (stopReason=%s)", parsed.stopReason)
		return grokCLIResult{}, requestErr
	}
	return grokCLIResult{
		Content:  parsed.Content,
		Thinking: parsed.Thinking,
		Usage:    parsed.Usage,
	}, nil
}

type grokCLIParsed struct {
	grokCLIResult
	stopReason string
}

func parseGrokCLIResponse(raw []byte) (grokCLIParsed, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return grokCLIParsed{}, fmt.Errorf("empty output")
	}
	var payload grokCLIResponse
	if err := json.Unmarshal(trimmed, &payload); err != nil {
		return grokCLIParsed{}, err
	}
	return grokCLIParsed{
		grokCLIResult: grokCLIResult{
			Content:  strings.TrimSpace(payload.Text),
			Thinking: strings.TrimSpace(payload.Thought),
			Usage: ai.TokenUsage{
				PromptTokens:     payload.Usage.InputTokens,
				CompletionTokens: payload.Usage.OutputTokens,
				TotalTokens:      payload.Usage.TotalTokens,
			},
		},
		stopReason: payload.StopReason,
	}, nil
}

func buildGrokCLIArgs(config ai.ProviderConfig, prompt string) ([]string, error) {
	args := []string{
		"-p", prompt,
		"--output-format", "json",
		// grok 没有 --ignore-user-config/--ignore-rules；覆盖系统提示是唯一能阻断
		// 用户全局规则进入本次调用的手段。
		"--system-prompt-override", grokCLISystemPrompt,
		// 空白名单 = 不允许任何内置工具。本 provider 只做对话与 SQL 生成，
		// 数据库访问由 GoNavi 自己的工具层负责，不经由 CLI 的文件/命令工具。
		"--tools", "",
		"--disable-web-search",
	}

	capability, ok := LookupCLICapability("grok-cli")
	if !ok {
		return nil, fmt.Errorf("grok-cli capability is not registered")
	}
	if model := strings.TrimSpace(config.Model); model != "" {
		args = append(args, capability.ModelFlag, model)
	}
	effort, err := capability.NormalizeEffort(config.Effort)
	if err != nil {
		// 档位非法时直接失败，而不是让 grok 去拒绝——它拒绝时退出码是 0，会被误判成成功。
		return nil, err
	}
	args = capability.AppendEffortArgs(args, effort)
	return args, nil
}

func buildGrokCLIRequestLogBody(args []string, prompt string, config ai.ProviderConfig, req ai.ChatRequest) map[string]any {
	return map[string]any{
		"args":          args,
		"promptChars":   len(prompt),
		"model":         strings.TrimSpace(config.Model),
		"effort":        strings.TrimSpace(config.Effort),
		"messageCount":  len(req.Messages),
		"isolationMode": grokCLIIsolationNote,
	}
}
