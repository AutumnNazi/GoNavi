package plugin

import (
	"context"
	"testing"
	"time"
)

func TestSDKLifecycleRunningCallback(t *testing.T) {
	got := make(chan string, 1)
	conn := connectTest(t, Options{OnLifecycle: func(_ context.Context, event string, generation uint64) {
		got <- event
		if generation != 7 {
			t.Errorf("generation %d", generation)
		}
	}})
	conn.send(t, `{"jsonrpc":"2.0","method":"plugin.lifecycle","params":{"event":"running","generation":7}}`)
	select {
	case event := <-got:
		if event != "running" {
			t.Fatal(event)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("lifecycle callback was not called")
	}
}
