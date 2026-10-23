// Command read-only-database serves a fixed in-memory fixture, not an arbitrary SQL engine.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"time"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	dispatcher := plugin.NewDataSourceDispatcher(newFixture().operations())
	server := plugin.NewServer(plugin.Options{Handlers: map[string]plugin.Handler{"database": dispatcher.Handle}})
	serveErr := server.ServeStdio(ctx)
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	closeErr := dispatcher.Close(cleanup)
	if (serveErr != nil && !errors.Is(serveErr, context.Canceled)) || closeErr != nil {
		// Provider errors may contain credentials. Keep process diagnostics constant.
		if _, err := fmt.Fprintln(os.Stderr, "read-only fixture stopped with an error"); err != nil {
			os.Exit(2)
		}
		os.Exit(1)
	}
}
