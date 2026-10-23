package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"testing"
	"time"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func TestHelloManifestNotes(t *testing.T) {
	raw, err := os.ReadFile("gonavi.plugin.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest plugin.Manifest
	if err = json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if err = plugin.ValidatePermissionNotes(manifest); err != nil {
		t.Fatal(err)
	}
}

func TestHello(t *testing.T) {
	for _, tt := range []struct {
		name, args string
		fail       bool
	}{
		{name: "default", args: `{}`},
		{name: "named", args: `{"name":"SDK"}`},
		{name: "negative delay", args: `{"delayMillis":-1}`, fail: true},
		{name: "wrong type", args: `{"name":1}`, fail: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			result, err := hello(context.Background(), json.RawMessage(tt.args))
			if (err != nil) != tt.fail {
				t.Fatalf("result=%v err=%v", result, err)
			}
		})
	}
}

func TestHelloLogsWhenRunning(t *testing.T) {
	input, hostInput := io.Pipe()
	hostOutput, output := io.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- plugin.NewServer(plugin.Options{Handlers: map[string]plugin.Handler{"hello": hello}, OnLifecycle: onRunning}).Serve(ctx, input, output)
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
	send(`{"jsonrpc":"2.0","id":1,"method":"plugin.initialize","params":{"apiVersion":1,"pluginId":"example.hello","version":"1.0.0","generation":3,"config":{},"permissions":["host.log"]}}`)
	if read()["result"] == nil {
		t.Fatal("initialize")
	}
	send(`{"jsonrpc":"2.0","method":"plugin.lifecycle","params":{"event":"running","generation":3}}`)
	call := read()
	params, _ := call["params"].(map[string]any)
	if call["method"] != "host.log" || params["message"] != "example.hello running" {
		t.Fatalf("log: %#v", call)
	}
	id, _ := json.Marshal(call["id"])
	send(`{"jsonrpc":"2.0","id":` + string(id) + `,"result":{}}`)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("server did not stop")
	}
}

func TestHelloCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	_, err := hello(ctx, json.RawMessage(`{"delayMillis":60000}`))
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cancellation: %v", err)
	}
}
