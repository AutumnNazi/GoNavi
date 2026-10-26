package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

type providerProcess struct {
	input       io.WriteCloser
	decoder     *json.Decoder
	command     *exec.Cmd
	cancel      context.CancelFunc
	diagnostics bytes.Buffer
	nextID      int
	waited      bool
}

type processReply struct {
	ID     int             `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  *plugin.Error   `json:"error"`
}

func buildIndependentProcess(t *testing.T) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	binary := filepath.Join(t.TempDir(), "provider")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	build := exec.CommandContext(ctx, "go", "build", "-o", binary, ".")
	build.Env = append(os.Environ(), "GOWORK=off", "GOPROXY=off", "GOSUMDB=off")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build independent example: %v\n%s", err, output)
	}
	deps := exec.CommandContext(ctx, "go", "list", "-deps", ".")
	deps.Env = build.Env
	output, err := deps.CombinedOutput()
	if err != nil {
		t.Fatalf("list independent example dependencies: %v\n%s", err, output)
	}
	if strings.Contains(string(output), "GoNavi-Wails/") {
		t.Fatal("example imports host internal packages")
	}
	return binary
}

func startIndependentProcess(t *testing.T, binary string) *providerProcess {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	process := &providerProcess{cancel: cancel, command: exec.CommandContext(ctx, binary)}
	input, err := process.command.StdinPipe()
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	output, err := process.command.StdoutPipe()
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	process.input = input
	process.decoder = json.NewDecoder(output)
	process.command.Stderr = &process.diagnostics
	if err := process.command.Start(); err != nil {
		cancel()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cancel()
		if !process.waited {
			if err := process.command.Wait(); err != nil && ctx.Err() == nil {
				t.Error(err)
			}
		}
	})
	process.rpc(t, "plugin.initialize", plugin.InitializeParams{
		APIVersion: 1, PluginID: "sdk.examples.aiprovider", Version: "1.0.0",
		Generation: 7, Permissions: []string{"ai.providers"}, Config: json.RawMessage(`{}`),
	}, false)
	return process
}

func (p *providerProcess) rpc(t *testing.T, method string, params any, wantError bool) processReply {
	t.Helper()
	p.nextID++
	if err := json.NewEncoder(p.input).Encode(map[string]any{
		"jsonrpc": "2.0", "id": p.nextID, "method": method, "params": params,
	}); err != nil {
		t.Fatal(err)
	}
	var reply processReply
	if err := p.decoder.Decode(&reply); err != nil {
		t.Fatal(err)
	}
	if reply.ID != p.nextID || (reply.Error != nil) != wantError {
		t.Fatalf("unexpected RPC reply: ID=%d error=%v", reply.ID, reply.Error)
	}
	return reply
}

func (p *providerProcess) invoke(t *testing.T, operation, requestID string, start *plugin.AIProviderStart, wantError bool) processReply {
	t.Helper()
	args := map[string]any{"protocolVersion": 1, "operation": operation, "providerId": "http", "requestId": requestID}
	if start != nil {
		args["config"] = start.Config
		args["request"] = start.Request
	}
	return p.rpc(t, "plugin.invoke", map[string]any{"commandId": "provider", "arguments": args}, wantError)
}

func (p *providerProcess) pull(t *testing.T, requestID string) []plugin.AIProviderEvent {
	t.Helper()
	reply := p.invoke(t, "pull", requestID, nil, false)
	var batch struct {
		Events []plugin.AIProviderEvent `json:"events"`
	}
	if err := json.Unmarshal(reply.Result, &batch); err != nil {
		t.Fatal(err)
	}
	return batch.Events
}

func (p *providerProcess) wait(t *testing.T) {
	t.Helper()
	err := p.command.Wait()
	p.waited = true
	if err != nil {
		t.Fatalf("independent example exit: %v", err)
	}
	if p.diagnostics.Len() != 0 {
		t.Fatal("example emitted unexpected diagnostics")
	}
}
