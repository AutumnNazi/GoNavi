package mcpserver

import (
	"bytes"
	"errors"
	"flag"
	"strings"
	"testing"
)

// 各子模式的 flag 输出被设成了丢弃，用法只能由这些 Write*Usage 补上。
// 这里锁定「确实有内容且提到自己的子模式」，防止用法被清空后
// -h/--help 又退化成空屏。
func TestUsageWritersDocumentTheirSubmode(t *testing.T) {
	cases := []struct {
		name      string
		write     func(*bytes.Buffer)
		wantParts []string
	}{
		{
			name:      "app mcp-server",
			write:     func(buf *bytes.Buffer) { WriteAppMCPServerUsage(buf) },
			wantParts: []string{"mcp-server", "stdio", "http", "remote-config"},
		},
		{
			name:      "http",
			write:     func(buf *bytes.Buffer) { WriteHTTPServerUsage(buf) },
			wantParts: []string{"mcp-server http", "--addr", "--token", "--schema-only"},
		},
		{
			name:      "remote-config",
			write:     func(buf *bytes.Buffer) { WriteRemoteMCPClientConfigUsage(buf) },
			wantParts: []string{"remote-config", "--client", "--url", "--token"},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			var buf bytes.Buffer
			testCase.write(&buf)

			output := buf.String()
			if strings.TrimSpace(output) == "" {
				t.Fatal("usage is empty; -h/--help would print a blank screen")
			}
			for _, part := range testCase.wantParts {
				if !strings.Contains(output, part) {
					t.Fatalf("usage = %q, want it to mention %q", output, part)
				}
			}
		})
	}
}

// 用法输出目标为 nil 时不能 panic：调用方在某些路径下并不接终端。
func TestUsageWritersTolerateNilWriter(t *testing.T) {
	WriteAppMCPServerUsage(nil)
	WriteHTTPServerUsage(nil)
	WriteRemoteMCPClientConfigUsage(nil)
}

// -h 解析后必须返回 flag.ErrHelp，调用方（main.go 的 reportUsageHelp）
// 靠它把「求助」与「参数写错」区分开：前者退出码 0，后者仍是非零。
func TestHelpFlagReturnsErrHelp(t *testing.T) {
	if _, err := ParseHTTPServerOptions([]string{"--help"}); !errors.Is(err, flag.ErrHelp) {
		t.Fatalf("ParseHTTPServerOptions(--help) error = %v, want flag.ErrHelp", err)
	}
	if _, err := ParseRemoteMCPClientConfigOptions([]string{"-h"}); !errors.Is(err, flag.ErrHelp) {
		t.Fatalf("ParseRemoteMCPClientConfigOptions(-h) error = %v, want flag.ErrHelp", err)
	}
}

// 未知参数必须是普通错误，不能被帮助分支当成 ErrHelp 吞掉。
func TestUnknownFlagIsNotErrHelp(t *testing.T) {
	_, err := ParseHTTPServerOptions([]string{"--bogus"})
	if err == nil {
		t.Fatal("ParseHTTPServerOptions(--bogus) error = nil, want a failure")
	}
	if errors.Is(err, flag.ErrHelp) {
		t.Fatal("unknown flag must not be reported as ErrHelp")
	}
}
