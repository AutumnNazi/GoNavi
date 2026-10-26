// Command hello demonstrates a standalone GoNavi plugin with cooperative work.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"time"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	server := plugin.NewServer(plugin.Options{Handlers: map[string]plugin.Handler{"hello": hello}, OnLifecycle: onRunning})
	if err := server.ServeStdio(ctx); err != nil && !errors.Is(err, context.Canceled) {
		if _, writeErr := fmt.Fprintln(os.Stderr, "hello plugin stopped:", err); writeErr != nil {
			os.Exit(2)
		}
		os.Exit(1)
	}
}

func onRunning(ctx context.Context, event string, generation uint64) {
	if event != "running" || generation == 0 {
		return
	}
	host, ok := plugin.HostFromContext(ctx)
	if !ok {
		return
	}
	_ = host.Log(ctx, "info", "example.hello running")
}

func hello(ctx context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		Name        string `json:"name"`
		DelayMillis int    `json:"delayMillis"`
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, &plugin.Error{Code: -32602, Message: "arguments must contain name and optional delayMillis"}
	}
	args.Name = strings.TrimSpace(args.Name)
	if len(args.Name) > 256 || args.DelayMillis < 0 || args.DelayMillis > 60000 {
		return nil, &plugin.Error{Code: -32602, Message: "name or delayMillis exceeds the example limit"}
	}
	if args.Name == "" {
		args.Name = "GoNavi"
	}
	timer := time.NewTimer(time.Duration(args.DelayMillis) * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
	}
	return map[string]string{"message": "Hello, " + args.Name + "!"}, nil
}
