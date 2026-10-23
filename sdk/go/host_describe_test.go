package plugin

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"testing"
	"time"
)

func TestSDKHostDescribeRoundTrip(t *testing.T) {
	input, hostInput := io.Pipe()
	hostOutput, output := io.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- NewServer(Options{Handlers: map[string]Handler{"echo": func(ctx context.Context, _ json.RawMessage) (any, error) {
			host, _ := HostFromContext(ctx)
			identity, err := host.Describe(ctx)
			if err != nil || identity.PluginID != "example.hello" || identity.Generation != 3 {
				t.Errorf("identity %+v err %v", identity, err)
			}
			return map[string]bool{"ok": true}, nil
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
			t.Fatal(scanner.Text())
		}
		return body
	}
	send(`{"jsonrpc":"2.0","id":1,"method":"plugin.initialize","params":{"apiVersion":1,"pluginId":"example.hello","version":"1.0.0","generation":3,"config":{},"permissions":["host.describe"]}}`)
	_ = read()
	send(`{"jsonrpc":"2.0","id":2,"method":"plugin.invoke","params":{"commandId":"echo","arguments":{}}}`)
	call := read()
	if call["method"] != "host.describe" {
		t.Fatalf("call %#v", call)
	}
	id, _ := json.Marshal(call["id"])
	send(`{"jsonrpc":"2.0","id":` + string(id) + `,"result":{"pluginId":"example.hello","generation":3,"hostVersion":"9.9.9","locale":"zh-CN"}}`)
	if read()["id"] != float64(2) {
		t.Fatal("invoke did not finish")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("server did not stop")
	}
}
