package nativewindow

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

func watchPluginChild(ctx context.Context, parentCtx context.Context, cfg pluginChildOptions, watcher detachedParentWatcher, transport http.RoundTripper, quit func()) {
	client := &http.Client{Transport: transport, Timeout: time.Second}
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	failures := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-parentCtx.Done():
			quitPluginChild(quit)
			return
		case <-ticker.C:
			alive, err := watcher.Alive()
			if err != nil || !alive {
				quitPluginChild(quit)
				return
			}
			closing, err := pluginChildClosing(ctx, client, cfg)
			if err != nil {
				failures++
			} else {
				failures = 0
			}
			if closing || failures >= 3 {
				quitPluginChild(quit)
				return
			}
		}
	}
}

func pluginChildClosing(ctx context.Context, client *http.Client, cfg pluginChildOptions) (bool, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.endpoint+pluginBridgePrefix+"state", nil)
	if err != nil {
		return false, err
	}
	request.Header.Set(pluginTokenHeader, cfg.token)
	request.Header.Set(pluginWindowHeader, cfg.id)
	response, err := client.Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return true, nil
	}
	payload, err := readPluginBytes(response.Body, 256)
	if err != nil {
		return false, err
	}
	var state struct {
		Closing bool `json:"closing"`
	}
	if err := json.Unmarshal(payload, &state); err != nil {
		return false, err
	}
	return state.Closing, nil
}

func quitPluginChild(quit func()) {
	// Wails/native shutdown can itself stall behind a hung renderer. This local
	// fallback also covers parent death on Unix, where no Job Object exists.
	time.AfterFunc(pluginStopTimeout, killPluginChildTree)
	quit()
	// The timer intentionally remains armed until the process exits.
}
