package plugin

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const aiInitializeFrame = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"plugin.initialize\",\"params\":{\"apiVersion\":1,\"pluginId\":\"fixture\",\"version\":\"1.0.0\",\"generation\":1,\"config\":{},\"hostVersion\":\"test\",\"locale\":\"en\",\"permissions\":[]}}\n"

type aiDiscardOutput struct{}

func (aiDiscardOutput) Write(data []byte) (int, error) { return len(data), nil }
func (aiDiscardOutput) Close() error                   { return nil }

type aiErrorReader struct{ reader *strings.Reader }

func (r aiErrorReader) Read(data []byte) (int, error) {
	count, err := r.reader.Read(data)
	if err == io.EOF {
		return count, errors.New("fixture read error")
	}
	return count, err
}
func (aiErrorReader) Close() error { return nil }

func TestAIProviderServerCloseHookBeforeJoinsOnEveryExit(t *testing.T) {
	tests := []struct {
		name, tail string
		readError  bool
		wantError  bool
	}{
		{name: "EOF"}, {name: "read error", readError: true, wantError: true},
		{name: "oversize", tail: strings.Repeat("x", 2048) + "\n", wantError: true},
		{name: "shutdown", tail: "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"plugin.shutdown\"}\n"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			closed := make(chan struct{})
			var calls atomic.Int32
			server := NewServer(Options{MaxFrameBytes: 1024, ShutdownTimeout: 100 * time.Millisecond,
				Initialize: func(context.Context, InitializeParams) error { <-closed; return nil },
				OnClose: func() {
					if calls.Add(1) == 1 {
						close(closed)
					}
				},
			})
			source := strings.NewReader(aiInitializeFrame + test.tail)
			var input io.ReadCloser = io.NopCloser(source)
			if test.readError {
				input = aiErrorReader{reader: source}
			}
			err := server.Serve(context.Background(), input, aiDiscardOutput{})
			if (err != nil) != test.wantError {
				t.Fatalf("Serve: %v", err)
			}
			if calls.Load() != 1 {
				t.Fatalf("close hook calls: %d", calls.Load())
			}
			if err != nil && strings.Contains(err.Error(), "ignored cancellation") {
				t.Fatal("hook ran only after worker join")
			}
		})
	}
}

func TestAIProviderServerParentCancelAndInvalidInputCloseRoots(t *testing.T) {
	root, cancel := context.WithCancel(context.Background())
	defer cancel()
	input, writer := io.Pipe()
	defer writer.Close()
	entered, closed := make(chan struct{}), make(chan struct{})
	server := NewServer(Options{ShutdownTimeout: 100 * time.Millisecond, Initialize: func(context.Context, InitializeParams) error { close(entered); <-closed; return nil }, OnClose: func() { close(closed) }})
	result := make(chan error, 1)
	go func() { result <- server.Serve(root, input, aiDiscardOutput{}) }()
	if _, err := io.WriteString(writer, aiInitializeFrame); err != nil {
		t.Fatal(err)
	}
	<-entered
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("parent cancel: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("parent cancel failed to close roots")
	}
	var calls atomic.Int32
	invalid := NewServer(Options{OnClose: func() { calls.Add(1) }})
	if err := invalid.Serve(nil, nil, nil); err == nil || calls.Load() != 1 {
		t.Fatal("invalid Serve exit omitted root close")
	}
}
