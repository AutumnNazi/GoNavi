package plugin

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"testing"
	"time"
)

func TestSDKHostLogRoundTripAndLocalRejection(t *testing.T) {
	input, hostInput := io.Pipe()
	hostOutput, output := io.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- NewServer(Options{Handlers: map[string]Handler{"echo": func(ctx context.Context, _ json.RawMessage) (any, error) {
			host, ok := HostFromContext(ctx)
			if !ok {
				t.Error("handler has no host")
			}
			if err := host.Log(ctx, "debug", "nope"); err == nil {
				t.Error("invalid level was sent")
			}
			return map[string]bool{"ok": host.Log(ctx, "warn", "snapshot ready") == nil}, nil
		}}}).Serve(ctx, input, output)
	}()
	send := func(frame string) {
		if _, err := hostInput.Write([]byte(frame + "\n")); err != nil {
			t.Fatal(err)
		}
	}
	scanner := bufio.NewScanner(hostOutput)
	read := func() map[string]any {
		if !scanner.Scan() {
			t.Fatal(scanner.Err())
		}
		var body map[string]any
		if json.Unmarshal(scanner.Bytes(), &body) != nil {
			t.Fatalf("frame: %s", scanner.Text())
		}
		return body
	}
	send(`{"jsonrpc":"2.0","id":1,"method":"plugin.initialize","params":{"apiVersion":1,"pluginId":"test.sdk","version":"1.0.0","generation":1,"config":{},"permissions":["host.log"]}}`)
	if read()["result"] == nil {
		t.Fatal("initialize failed")
	}
	send(`{"jsonrpc":"2.0","id":2,"method":"plugin.invoke","params":{"commandId":"echo","arguments":{}}}`)
	call := read()
	if call["method"] != "host.log" {
		t.Fatalf("host call: %#v", call)
	}
	params, _ := call["params"].(map[string]any)
	if params["level"] != "warn" || params["message"] != "snapshot ready" {
		t.Fatalf("params: %#v", params)
	}
	id, _ := call["id"].(string)
	send(`{"jsonrpc":"2.0","id":` + jsonQuote(id) + `,"result":{}}`)
	result := read()
	if result["id"] != float64(2) {
		t.Fatalf("invoke result: %#v", result)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("server did not stop")
	}
}

func jsonQuote(value string) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}
