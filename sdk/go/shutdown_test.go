package plugin

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestShutdownBoundsAnIgnoringHandler(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	exited := make(chan struct{})
	c := connectTest(t, Options{ShutdownTimeout: 50 * time.Millisecond, Handlers: map[string]Handler{"hold": func(context.Context, json.RawMessage) (any, error) {
		close(started)
		<-release
		close(exited)
		return nil, nil
	}}})
	defer close(release)
	c.initialize(t)
	c.send(t, `{"jsonrpc":"2.0","id":2,"method":"plugin.invoke","params":{"commandId":"hold"}}`)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("handler did not start")
	}
	c.send(t, `{"jsonrpc":"2.0","id":3,"method":"plugin.shutdown","params":{}}`)
	if r := c.receive(t); string(r.ID) != "3" || r.Error != nil {
		t.Fatalf("shutdown: %+v", r)
	}
	select {
	case err := <-c.done:
		if err == nil || !strings.Contains(err.Error(), "ignored cancellation") {
			t.Fatalf("bounded cleanup: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown waited for uncooperative handler")
	}
	select {
	case <-exited:
		t.Fatal("fixture did not actually ignore cancellation")
	default:
	}
}

func TestInitializePanicDoesNotFreezeControlState(t *testing.T) {
	var attempts atomic.Int32
	c := connectTest(t, Options{Initialize: func(context.Context, InitializeParams) error {
		if attempts.Add(1) == 1 {
			panic("private initialization detail")
		}
		return nil
	}})
	c.send(t, `{"jsonrpc":"2.0","id":0,"method":"plugin.initialize","params":{"apiVersion":1,"pluginId":"test.sdk"}}`)
	if r := c.receive(t); r.Error == nil || r.Error.Code != -32603 {
		t.Fatalf("panic: %+v", r)
	}
	c.initialize(t)
	if attempts.Load() != 2 {
		t.Fatal("initialization could not be retried")
	}
}
