package nativewindow

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type pluginChildOptions struct {
	endpoint  string
	token     string
	id        string
	profile   string
	parentPID int
	title     string
	width     int
	height    int
}

func parsePluginChildOptions(args []string) (pluginChildOptions, error) {
	if len(args) != 0 {
		return pluginChildOptions{}, errors.New("plugin window arguments must be provided by the host environment")
	}
	value := func(name string) string { return os.Getenv(pluginEnvPrefix + name) }
	cfg := pluginChildOptions{endpoint: value("ENDPOINT"), token: value("TOKEN"), id: value("ID"),
		profile: value("PROFILE"), title: value("TITLE")}
	var err error
	cfg.parentPID, err = strconv.Atoi(value("PARENT_PID"))
	if err != nil || cfg.parentPID <= 1 {
		return pluginChildOptions{}, errors.New("invalid plugin window parent")
	}
	cfg.width, err = strconv.Atoi(value("WIDTH"))
	if err != nil {
		return pluginChildOptions{}, errors.New("invalid plugin window width")
	}
	cfg.height, err = strconv.Atoi(value("HEIGHT"))
	if err != nil {
		return pluginChildOptions{}, errors.New("invalid plugin window height")
	}
	cfg.width = pluginWindowDimension(cfg.width, 960, 320, 3840)
	cfg.height = pluginWindowDimension(cfg.height, 720, 240, 2160)
	parsed, err := url.Parse(cfg.endpoint)
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return pluginChildOptions{}, errors.New("invalid plugin window endpoint")
	}
	ip := net.ParseIP(parsed.Hostname())
	if ip == nil || !ip.IsLoopback() || parsed.Port() == "" {
		return pluginChildOptions{}, errors.New("plugin window endpoint must be loopback")
	}
	if len(cfg.token) != 43 || len(cfg.id) != 43 || !pluginRequestIDPattern.MatchString(cfg.token) || !pluginRequestIDPattern.MatchString(cfg.id) {
		return pluginChildOptions{}, errors.New("invalid plugin window capability")
	}
	if !filepath.IsAbs(cfg.profile) || !strings.HasPrefix(filepath.Base(cfg.profile), "gonavi-plugin-window-") {
		return pluginChildOptions{}, errors.New("invalid plugin window profile")
	}
	return cfg, nil
}

// RunPluginChild starts only an isolated plugin UI. Dispatch this before
// creating App, host bindings, credentials, or the main frontend runtime.
func RunPluginChild(parentCtx context.Context, args []string) error {
	cfg, err := parsePluginChildOptions(args)
	if err != nil {
		return err
	}
	signalCtx, stopSignals := signal.NotifyContext(parentCtx, os.Interrupt, syscall.SIGTERM)
	defer stopSignals()
	// Separate normal Wails shutdown from host/signal termination: do not post
	// another Quit to a native event loop that has already exited.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := preparePluginProfile(cfg.profile); err != nil {
		return err
	}
	watcher, err := newDetachedParentWatcher(cfg.parentPID)
	if err != nil {
		return fmt.Errorf("watch plugin window parent: %w", err)
	}
	defer watcher.Close()
	var watchWG sync.WaitGroup
	defer func() { cancel(); watchWG.Wait() }()
	transport := &http.Transport{Proxy: nil, MaxConnsPerHost: 16, MaxIdleConnsPerHost: 4, ResponseHeaderTimeout: 32 * time.Second}
	defer transport.CloseIdleConnections()
	app := &options.App{Title: cfg.title, Width: cfg.width, Height: cfg.height, MinWidth: 320, MinHeight: 240,
		AssetServer: &assetserver.Options{Handler: newPluginChildProxy(cfg, transport)},
		DragAndDrop: &options.DragAndDrop{DisableWebViewDrop: true},
		// No App, no detached bridge, and no Go methods are bound to this WebView.
		Bind: []interface{}{}, OnStartup: func(wailsCtx context.Context) {
			watchWG.Add(1)
			go func() {
				defer watchWG.Done()
				watchPluginChild(ctx, signalCtx, cfg, watcher, transport, func() { wailsRuntime.Quit(wailsCtx) })
			}()
		}, OnShutdown: func(context.Context) { cancel() }}
	if err := configurePluginWebview(app, cfg.profile); err != nil {
		return err
	}
	return wails.Run(app)
}

func newPluginChildProxy(cfg pluginChildOptions, transport http.RoundTripper) http.Handler {
	endpoint, _ := url.Parse(cfg.endpoint)
	proxy := httputil.NewSingleHostReverseProxy(endpoint)
	proxy.Transport = transport
	proxy.Director = func(request *http.Request) {
		request.URL.Scheme = endpoint.Scheme
		request.URL.Host = endpoint.Host
		request.Host = endpoint.Host
		request.Header.Del("Cookie")
		request.Header.Del("Authorization")
		request.Header.Del("Origin")
		request.Header.Del("Referer")
		request.Header.Set(pluginTokenHeader, cfg.token)
		request.Header.Set(pluginWindowHeader, cfg.id)
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		pluginHTTPError(w, http.StatusBadGateway, "host_unavailable")
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Even malformed plugin fetches cannot turn the child into an App RPC proxy.
		if r.URL.Path != "/" && !strings.HasPrefix(r.URL.Path, pluginAssetPrefix) && !strings.HasPrefix(r.URL.Path, pluginBridgePrefix) {
			http.NotFound(w, r)
			return
		}
		proxy.ServeHTTP(w, r)
	})
}
