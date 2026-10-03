// Package syncworker manages a per-data-root background process for saved tasks.
package syncworker

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type state struct {
	Address string `json:"address"`
	Token   string `json:"token"`
}

func statePath(root string) string { return filepath.Join(root, "data_sync", "worker.json") }

// Ensure starts the executable in worker mode and waits until its backend is ready.
func Ensure(ctx context.Context, root, executable string) error {
	if healthy(ctx, root) {
		return nil
	}
	cmd := exec.Command(executable, "sync-worker", "--data-root", root)
	detach(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start sync worker: %w", err)
	}
	if err := cmd.Process.Release(); err != nil {
		return fmt.Errorf("release sync worker process: %w", err)
	}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait for sync worker: %w", ctx.Err())
		case <-ticker.C:
			if healthy(ctx, root) {
				return nil
			}
		}
	}
}

func healthy(ctx context.Context, root string) bool { return request(ctx, root, "/health") == nil }

func request(ctx context.Context, root, route string) error {
	payload, err := os.ReadFile(statePath(root))
	if err != nil {
		return err
	}
	var current state
	if err := json.Unmarshal(payload, &current); err != nil {
		return err
	}
	host, _, err := net.SplitHostPort(current.Address)
	if err != nil || host != "127.0.0.1" || current.Token == "" {
		return errors.New("invalid sync worker state")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://"+current.Address+route, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+current.Token)
	client := http.Client{Timeout: 500 * time.Millisecond, Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		return errors.New("sync worker is unavailable")
	}
	return nil
}

// Stop waits for the worker to drain before a data-root move or maintenance.
func Stop(ctx context.Context, root string) error {
	if healthy(ctx, root) {
		if err := request(ctx, root, "/stop"); err != nil {
			return err
		}
	}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		lock, err := acquire(root)
		if err == nil {
			return lock.Close()
		}
		if !errors.Is(err, errLocked) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

// Run holds a kernel lock for the worker lifetime. Health is published only
// after initialization. The listener accepts no database or filesystem input.
func Run(ctx context.Context, root string, start func(context.Context) (func(), error)) error {
	lock, err := acquire(root)
	if errors.Is(err, errLocked) {
		return nil
	}
	if err != nil {
		return err
	}
	defer lock.Close()
	workerCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	closeRuntime, err := start(workerCtx)
	if err != nil {
		return err
	}
	defer closeRuntime()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("listen for sync worker health: %w", err)
	}
	defer listener.Close()
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		return err
	}
	current := state{Address: listener.Addr().String(), Token: hex.EncodeToString(token)}
	server := &http.Server{ReadHeaderTimeout: time.Second, ReadTimeout: time.Second, WriteTimeout: time.Second, IdleTimeout: time.Second}
	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		supplied := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if r.Method != http.MethodPost || subtle.ConstantTimeCompare([]byte(supplied), []byte(current.Token)) != 1 {
			http.Error(w, "denied", http.StatusForbidden)
			return
		}
		switch r.URL.Path {
		case "/health":
			w.WriteHeader(http.StatusNoContent)
		case "/stop":
			w.WriteHeader(http.StatusNoContent)
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			cancel()
		default:
			http.NotFound(w, r)
		}
	})
	served := make(chan struct{})
	var serveErr error
	go func() { serveErr = server.Serve(listener); close(served) }()
	defer func() { server.Close(); <-served }()
	payload, err := json.Marshal(current)
	if err != nil {
		return err
	}
	if err := os.WriteFile(statePath(root), payload, 0o600); err != nil {
		return err
	}
	defer os.Remove(statePath(root))
	select {
	case <-workerCtx.Done():
		return nil
	case <-served:
		if errors.Is(serveErr, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serve sync worker health: %w", serveErr)
	}
}

var errLocked = errors.New("sync worker is already running")

func acquire(root string) (*os.File, error) {
	directory := filepath.Join(root, "data_sync")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filepath.Join(directory, "worker.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := lockFile(file); err != nil {
		file.Close()
		return nil, err
	}
	return file, nil
}
