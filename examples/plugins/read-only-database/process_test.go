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

type fixtureProcess struct {
	input   io.WriteCloser
	decoder *json.Decoder
}
type fixtureReply struct {
	ID     int             `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  *plugin.Error   `json:"error"`
}

func (p fixtureProcess) send(t *testing.T, id int, method string, params any) {
	t.Helper()
	if err := json.NewEncoder(p.input).Encode(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
		t.Fatal(err)
	}
}
func (p fixtureProcess) invoke(t *testing.T, id int, request plugin.DataSourceRequest) {
	t.Helper()
	p.send(t, id, "plugin.invoke", map[string]any{"commandId": "database", "arguments": request})
}
func (p fixtureProcess) reply(t *testing.T, id int, wantError bool) fixtureReply {
	t.Helper()
	var response fixtureReply
	if err := p.decoder.Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.ID != id || (response.Error != nil) != wantError {
		t.Fatalf("reply ID=%d error=%v; expected ID=%d error=%v", response.ID, response.Error, id, wantError)
	}
	return response
}

func TestIndependentDatasourceProcess(t *testing.T) {
	buildCtx, buildCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer buildCancel()
	binary := filepath.Join(t.TempDir(), "fixture")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	build := exec.CommandContext(buildCtx, "go", "build", "-o", binary, ".")
	build.Env = append(os.Environ(), "GOWORK=off", "GOPROXY=off", "GOSUMDB=off")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build independent fixture: %v\n%s", err, output)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary)
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var diagnostics bytes.Buffer
	command.Stderr = &diagnostics
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	defer func() {
		cancel()
		input.Close()
		if !waited {
			if err := command.Wait(); err != nil && ctx.Err() == nil {
				t.Error(err)
			}
		}
	}()
	process := fixtureProcess{input: input, decoder: json.NewDecoder(output)}
	process.send(t, 1, "plugin.initialize", plugin.InitializeParams{APIVersion: 1, PluginID: "sdk.examples.readonly", Version: "1.0.0", Generation: 7, Permissions: []string{"data.sources"}})
	process.reply(t, 1, false)
	session := strings.Repeat("A", 43)
	request := plugin.DataSourceRequest{ProtocolVersion: 1, Operation: "connect", SessionID: session, Config: &plugin.DataSourceConfig{Host: "memory", Database: "fixture", Password: "sensitive-test-password"}}
	process.invoke(t, 2, request)
	process.reply(t, 2, false)
	request.Config = nil
	request.Operation = "query"
	request.Query = "SELECT * FROM people"
	process.invoke(t, 3, request)
	result := process.reply(t, 3, false)
	var rows plugin.DataSourceQueryResult
	if err = json.Unmarshal(result.Result, &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows.Rows) != 3 || rows.Rows[0]["score"] != "9007199254740993" {
		t.Fatalf("wrong fixture values: %s", result.Result)
	}
	request.Operation = "allColumns"
	request.Query = ""
	request.Database = "fixture"
	process.invoke(t, 4, request)
	result = process.reply(t, 4, false)
	var metadata struct {
		AllColumns []plugin.DataSourceColumnDefinitionWithTable `json:"allColumns"`
	}
	if err = json.Unmarshal(result.Result, &metadata); err != nil || len(metadata.AllColumns) != 3 {
		t.Fatalf("bad metadata: %s %v", result.Result, err)
	}
	request.Operation = "query"
	request.Query = "DELETE FROM people"
	process.invoke(t, 5, request)
	process.reply(t, 5, true)
	testFixtureCancellation(t, process, request)
	request.Operation = "close"
	request.Query = ""
	process.invoke(t, 21, request)
	process.reply(t, 21, false)
	request.Operation = "ping"
	process.invoke(t, 22, request)
	process.reply(t, 22, true)
	process.send(t, 30, "plugin.shutdown", map[string]any{})
	process.reply(t, 30, false)
	if err = command.Wait(); err != nil {
		waited = true
		t.Fatalf("fixture exit: %v", err)
	}
	waited = true
	if strings.Contains(diagnostics.String(), "sensitive-test-password") {
		t.Fatal("fixture logged selected credentials")
	}
}

func testFixtureCancellation(t *testing.T, process fixtureProcess, request plugin.DataSourceRequest) {
	t.Helper()
	request.Query = "SELECT sleep_ms(5000)"
	started := time.Now()
	process.invoke(t, 20, request)
	process.send(t, 19, "plugin.ping", map[string]any{})
	process.reply(t, 19, false)
	if err := json.NewEncoder(process.input).Encode(map[string]any{"jsonrpc": "2.0", "method": "$/cancelRequest", "params": map[string]int{"id": 20}}); err != nil {
		t.Fatal(err)
	}
	response := process.reply(t, 20, true)
	if response.Error.Code != -32800 || time.Since(started) > 2*time.Second {
		t.Fatal("process control or cancellation did not stay responsive")
	}
}
