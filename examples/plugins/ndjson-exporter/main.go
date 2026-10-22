// Command ndjson-exporter renders only the supplied materialized tagged-cell snapshot.
// It performs no database, network or destination-file operations.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	dispatcher, err := plugin.NewExporterDispatcher(map[string]plugin.ExporterRender{"ndjson": renderNDJSON})
	if err == nil {
		err = plugin.NewServer(plugin.Options{Handlers: map[string]plugin.Handler{"render": dispatcher.Handle}}).ServeStdio(ctx)
	}
	if err != nil && !errors.Is(err, context.Canceled) {
		if _, writeErr := fmt.Fprintln(os.Stderr, "NDJSON exporter stopped with an error"); writeErr != nil {
			os.Exit(2)
		}
		os.Exit(1)
	}
}
