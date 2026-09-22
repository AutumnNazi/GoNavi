package provider

import (
	"os"
	"path/filepath"
	"strings"
)

// withGrokCLIAPIKeyAuth 让这次嵌入调用使用配置里的 API Key，而不是登录态的 OIDC token。
// 自定义网关不认 xAI 的会话令牌，会直接回 HTTP 403。只改子进程的 GROK_HOME，不动用户自己的登录。
func withGrokCLIAPIKeyAuth(env []string) ([]string, func()) {
	noop := func() {}
	source := grokCLIConfigPathFromEnv(env)
	home, cleanup, err := prepareGrokCLIAPIKeyHome(source)
	if err != nil {
		return env, noop
	}
	return upsertEnv(env, "GROK_HOME", home), cleanup
}

func grokCLIConfigPathFromEnv(env []string) string {
	if home := strings.TrimSpace(envValue(env, "GROK_HOME")); home != "" {
		return filepath.Join(home, "config.toml")
	}
	userHome, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(userHome) == "" {
		return ""
	}
	return filepath.Join(userHome, ".grok", "config.toml")
}

func prepareGrokCLIAPIKeyHome(sourceConfig string) (string, func(), error) {
	noop := func() {}
	data, err := os.ReadFile(sourceConfig)
	if err != nil {
		return "", noop, err
	}
	home, err := os.MkdirTemp("", "gonavi-grok-home-")
	if err != nil {
		return "", noop, err
	}
	cleanup := func() { _ = os.RemoveAll(home) }
	if err := os.Chmod(home, 0o700); err != nil {
		cleanup()
		return "", noop, err
	}
	if err := os.WriteFile(filepath.Join(home, "config.toml"), []byte(pinGrokAPIKeyAuth(string(data))), 0o600); err != nil {
		cleanup()
		return "", noop, err
	}
	return home, cleanup, nil
}

// pinGrokAPIKeyAuth 把自动鉴权钉在 api_key 上，避免缓存的登录令牌盖过模型配置里的密钥。
func pinGrokAPIKeyAuth(config string) string {
	lines := strings.Split(config, "\n")
	out := make([]string, 0, len(lines)+3)
	inAuth := false
	sawAuth := false
	replaced := false
	flushAuthKey := func() {
		if inAuth && !replaced {
			out = append(out, `preferred_method = "api_key"`)
			replaced = true
		}
	}
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			flushAuthKey()
			inAuth = trimmed == "[auth]"
			if inAuth {
				sawAuth = true
			}
			out = append(out, line)
			continue
		}
		if inAuth && strings.HasPrefix(trimmed, "preferred_method") {
			out = append(out, `preferred_method = "api_key"`)
			replaced = true
			continue
		}
		out = append(out, line)
	}
	flushAuthKey()
	if !sawAuth {
		if len(out) > 0 && strings.TrimSpace(out[len(out)-1]) != "" {
			out = append(out, "")
		}
		out = append(out, "[auth]", `preferred_method = "api_key"`)
	}
	return strings.Join(out, "\n")
}
