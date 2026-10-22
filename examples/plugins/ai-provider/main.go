// Command ai-provider forwards selected configuration to an explicit HTTP/SSE upstream.
// The declared model is a configuration target, not a locally implemented model.
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
	root, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := serve(root); err != nil {
		// Keep diagnostics constant: upstream errors and configuration may contain secrets.
		if _, writeErr := fmt.Fprintln(os.Stderr, "HTTP AI provider stopped with an error"); writeErr != nil {
			os.Exit(2)
		}
		os.Exit(1)
	}
}

func providerModels() []plugin.AIModel {
	return []plugin.AIModel{{
		ID: "gpt-4o-mini", Name: "GPT-4o mini (configured upstream)",
		ContextWindow: 128000, MaxOutputTokens: 16384,
	}}
}

func serve(ctx context.Context) error {
	upstream := newHTTPProvider()
	defer upstream.client.CloseIdleConnections()
	dispatcher, err := plugin.NewAIProviderDispatcher(ctx, plugin.AIProviderOptions{
		Providers: map[string]plugin.AIProviderRegistration{
			"http": {Models: providerModels(), SupportsTools: true, Generate: upstream.generate},
		},
	})
	if err != nil {
		return failure("generation_failed")
	}
	server := plugin.NewServer(plugin.Options{
		Handlers: map[string]plugin.Handler{"provider": dispatcher.Handle},
		OnClose:  dispatcher.Abort,
	})
	serveErr := server.ServeStdio(ctx)
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	if err := dispatcher.Close(cleanup); err != nil {
		return err
	}
	if serveErr != nil && !errors.Is(serveErr, context.Canceled) {
		return failure("generation_failed")
	}
	return nil
}
