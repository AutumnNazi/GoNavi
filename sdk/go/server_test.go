package plugin

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"
)

type testConnection struct {
	input     *io.PipeWriter
	responses <-chan response
	done      <-chan error
	cancel    context.CancelFunc
}

func connectTest(t *testing.T, options Options) *testConnection {
	t.Helper()
	input, hostInput := io.Pipe()
	hostOutput, output := io.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	// One completion and up to 64 protocol responses fit without a reader stall.
	done := make(chan error, 1)
	replies := make(chan response, 64)
	go func() { done <- NewServer(options).Serve(ctx, input, output); close(done) }()
	go func() {
		defer close(replies)
		scanner := bufio.NewScanner(hostOutput)
		for scanner.Scan() {
			var reply response
			if json.Unmarshal(scanner.Bytes(), &reply) != nil {
				return
			}
			replies <- reply
		}
	}()
	t.Cleanup(func() {
		cancel()
		if err := hostInput.Close(); err != nil {
			t.Error(err)
		}
		if err := hostOutput.Close(); err != nil {
			t.Error(err)
		}
	})
	return &testConnection{input: hostInput, responses: replies, done: done, cancel: cancel}
}

func (c *testConnection) send(t *testing.T, frame string) {
	t.Helper()
	if _, err := fmt.Fprintln(c.input, frame); err != nil {
		t.Fatal(err)
	}
}

func (c *testConnection) receive(t *testing.T) response {
	t.Helper()
	select {
	case r, ok := <-c.responses:
		if !ok {
			t.Fatal("protocol closed before reply")
		}
		return r
	case <-time.After(2 * time.Second):
		t.Fatal("protocol reader stalled")
	}
	return response{}
}

func (c *testConnection) initialize(t *testing.T) {
	t.Helper()
	c.send(t, `{"jsonrpc":"2.0","id":1,"method":"plugin.initialize","params":{"apiVersion":1,"pluginId":"test.sdk","version":"1.0.0","generation":1,"config":{},"permissions":[]}}`)
	reply := c.receive(t)
	if reply.Error != nil || string(reply.Result) != `{"apiVersion":1}` {
		t.Fatalf("initialize: %+v", reply)
	}
}

func TestControlsRemainResponsiveDuringInvocation(t *testing.T) {
	started := make(chan struct{})
	cancelled := make(chan struct{})
	c := connectTest(t, Options{Handlers: map[string]Handler{"wait": func(ctx context.Context, _ json.RawMessage) (any, error) {
		close(started)
		<-ctx.Done()
		close(cancelled)
		return nil, ctx.Err()
	}}})
	c.initialize(t)
	c.send(t, `{"jsonrpc":"2.0","id":"work","method":"plugin.invoke","params":{"commandId":"wait","arguments":{}}}`)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("handler not started")
	}
	c.send(t, `{"jsonrpc":"2.0","id":2,"method":"plugin.ping","params":{}}`)
	if r := c.receive(t); string(r.ID) != "2" || r.Error != nil {
		t.Fatalf("ping: %+v", r)
	}
	c.send(t, `{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":"work"}}`)
	if r := c.receive(t); r.Error == nil || r.Error.Code != -32800 {
		t.Fatalf("cancel: %+v", r)
	}
	select {
	case <-cancelled:
	default:
		t.Fatal("context cancellation did not reach handler")
	}
	c.send(t, `{"jsonrpc":"2.0","id":3,"method":"plugin.shutdown","params":{}}`)
	if r := c.receive(t); string(r.ID) != "3" || r.Error != nil {
		t.Fatalf("shutdown: %+v", r)
	}
	select {
	case err := <-c.done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown did not exit")
	}
}

func TestControlsRemainResponsiveDuringInitialize(t *testing.T) {
	started := make(chan struct{})
	c := connectTest(t, Options{Initialize: func(ctx context.Context, _ InitializeParams) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}})
	c.send(t, `{"jsonrpc":"2.0","id":1,"method":"plugin.initialize","params":{"apiVersion":1,"pluginId":"test.sdk"}}`)
	<-started
	c.send(t, `{"jsonrpc":"2.0","id":2,"method":"plugin.ping","params":{}}`)
	if r := c.receive(t); string(r.ID) != "2" {
		t.Fatalf("ping while initializing: %+v", r)
	}
	c.cancel()
	select {
	case err := <-c.done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled server stuck")
	}
}

func TestProtocolErrorsAndLimits(t *testing.T) {
	tests := []struct {
		name, frame string
		code        int
	}{
		{name: "malformed", frame: "{", code: -32700},
		{name: "wrong version", frame: `{"jsonrpc":"1.0","id":1,"method":"plugin.ping"}`, code: -32600},
		{name: "bad id", frame: `{"jsonrpc":"2.0","id":{},"method":"plugin.ping"}`, code: -32600},
		{name: "unknown method", frame: `{"jsonrpc":"2.0","id":1,"method":"host.arbitrary"}`, code: -32601},
		{name: "invoke before init", frame: `{"jsonrpc":"2.0","id":1,"method":"plugin.invoke","params":{"commandId":"x"}}`, code: -32002},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := connectTest(t, Options{})
			c.send(t, tt.frame)
			r := c.receive(t)
			if r.Error == nil || r.Error.Code != tt.code {
				t.Fatalf("reply %+v; want %d", r, tt.code)
			}
		})
	}
	t.Run("oversized frame", func(t *testing.T) {
		c := connectTest(t, Options{MaxFrameBytes: 128})
		c.send(t, strings.Repeat("x", 129))
		select {
		case err := <-c.done:
			if err == nil {
				t.Fatal("oversized frame accepted")
			}
		case <-time.After(time.Second):
			t.Fatal("unbounded frame reader")
		}
	})
}

func TestConcurrencyBoundDoesNotBlockPing(t *testing.T) {
	c := connectTest(t, Options{MaxConcurrent: 1, Handlers: map[string]Handler{"wait": func(ctx context.Context, _ json.RawMessage) (any, error) { <-ctx.Done(); return nil, ctx.Err() }}})
	c.initialize(t)
	c.send(t, `{"jsonrpc":"2.0","id":2,"method":"plugin.invoke","params":{"commandId":"wait"}}`)
	c.send(t, `{"jsonrpc":"2.0","id":3,"method":"plugin.invoke","params":{"commandId":"wait"}}`)
	if r := c.receive(t); r.Error == nil || r.Error.Code != -32001 {
		t.Fatalf("capacity: %+v", r)
	}
	c.send(t, `{"jsonrpc":"2.0","id":4,"method":"plugin.ping","params":{}}`)
	if r := c.receive(t); string(r.ID) != "4" || r.Error != nil {
		t.Fatalf("ping at capacity: %+v", r)
	}
}

func TestPanicAndOversizedResultsAreErrors(t *testing.T) {
	for _, command := range []string{"panic", "large", "secret"} {
		t.Run(command, func(t *testing.T) {
			c := connectTest(t, Options{MaxFrameBytes: 512, Handlers: map[string]Handler{
				"panic":  func(context.Context, json.RawMessage) (any, error) { panic("secret") },
				"large":  func(context.Context, json.RawMessage) (any, error) { return strings.Repeat("x", 1024), nil },
				"secret": func(context.Context, json.RawMessage) (any, error) { return nil, errors.New("secret") },
			}})
			c.initialize(t)
			c.send(t, fmt.Sprintf(`{"jsonrpc":"2.0","id":2,"method":"plugin.invoke","params":{"commandId":%q}}`, command))
			r := c.receive(t)
			if r.Error == nil || r.Error.Code != -32603 || strings.Contains(r.Error.Message, "secret") {
				t.Fatalf("unsafe result: %+v", r)
			}
		})
	}
}
