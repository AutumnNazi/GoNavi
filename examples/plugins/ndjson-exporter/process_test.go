package main

import (
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

type exportRPCReply struct {
	ID     int             `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  *plugin.Error   `json:"error"`
}

func TestIndependentNativeExporterProtocol(t *testing.T) {
	buildCtx, buildCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer buildCancel()
	binary := filepath.Join(t.TempDir(), "ndjson-exporter")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	build := exec.CommandContext(buildCtx, "go", "build", "-trimpath", "-o", binary, ".")
	build.Env = append(os.Environ(), "GOWORK=off", "GOPROXY=off", "GOSUMDB=off", "CGO_ENABLED=0")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("independent SDK build: %v %s", err, output)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	process := exec.CommandContext(ctx, binary)
	stdin, err := process.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := process.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = process.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	defer func() {
		if !waited {
			cancel()
			if closeErr := stdin.Close(); closeErr != nil && !strings.Contains(closeErr.Error(), "closed") {
				t.Error(closeErr)
			}
			if waitErr := process.Wait(); waitErr != nil && ctx.Err() == nil {
				t.Error(waitErr)
			}
		}
	}()
	encoder, decoder := json.NewEncoder(stdin), json.NewDecoder(stdout)
	invoke := func(id int, method string, params any) exportRPCReply {
		t.Helper()
		if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
			t.Fatal(err)
		}
		var reply exportRPCReply
		if err := decoder.Decode(&reply); err != nil {
			t.Fatal(err)
		}
		if reply.ID != id {
			t.Fatal("unexpected response order")
		}
		return reply
	}
	init := invoke(1, "plugin.initialize", plugin.InitializeParams{APIVersion: 1, PluginID: "sdk.examples.ndjson", Version: "1.0.0", Generation: 1, Config: json.RawMessage(`{}`), HostVersion: "test", Locale: "en", Permissions: []string{"data.export"}})
	if init.Error != nil {
		t.Fatal(init.Error)
	}
	request, err := plugin.EncodeExporterRequest(ctx, "ndjson", goldenSnapshot(t))
	if err != nil {
		t.Fatal(err)
	}
	rendered := invoke(2, "plugin.invoke", map[string]any{"commandId": "render", "arguments": json.RawMessage(request)})
	if rendered.Error != nil {
		t.Fatal(rendered.Error)
	}
	var result plugin.ExporterResult
	if err = json.Unmarshal(rendered.Result, &result); err != nil {
		t.Fatal(err)
	}
	if result.ProtocolVersion != 1 || result.RowCount != 1 || result.Text != goldenDocument {
		t.Fatal("native process changed tagged snapshot")
	}
	rejected := invoke(3, "plugin.invoke", map[string]any{"commandId": "render", "arguments": map[string]any{"protocolVersion": 1, "exporterId": "other", "columns": []string{"x"}, "rows": [][]plugin.ExporterCell{}}})
	if rejected.Error == nil {
		t.Fatal("unknown exporter invoked")
	}
	stopped := invoke(4, "plugin.shutdown", map[string]any{})
	if stopped.Error != nil {
		t.Fatal(stopped.Error)
	}
	if err = stdin.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = io.Copy(io.Discard, stdout); err != nil {
		t.Fatal(err)
	}
	if err = process.Wait(); err != nil {
		t.Fatal(err)
	}
	waited = true
}
