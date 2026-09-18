package aiservice

import (
	"context"
	"fmt"
	"net"
	"sync/atomic"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/secretstore"
)

func TestMCPHTTPServerRestoreRetriesTransientStartFailure(t *testing.T) {
	originalStarter := startMCPHTTPProcess
	originalHealth := waitMCPHTTPHealth
	originalAttempts := mcpHTTPRestoreAttempts
	mcpHTTPRestoreAttempts = 3
	t.Cleanup(func() {
		startMCPHTTPProcess = originalStarter
		waitMCPHTTPHealth = originalHealth
		mcpHTTPRestoreAttempts = originalAttempts
	})

	root := t.TempDir()
	t.Setenv("GONAVI_DATA_ROOT", root)
	configStore := NewProviderConfigStore(root, secretstore.NewUnavailableStore("test"))
	if err := configStore.Save(ProviderConfigStoreSnapshot{
		Providers:    []ai.ProviderConfig{},
		SafetyLevel:  ai.PermissionReadOnly,
		ContextLevel: ai.ContextSchemaOnly,
		MCPHTTPServer: ai.MCPHTTPServerConfig{
			Enabled: true,
			Addr:    "127.0.0.1:9131",
			Path:    "/mcp",
			Token:   "gnv_restore_retry_token",
		},
	}); err != nil {
		t.Fatalf("Save returned error: %v", err)
	}

	var starts atomic.Int32
	startMCPHTTPProcess = func(_ context.Context, _ mcpHTTPProcessStartOptions, _ mcpHTTPTextLookup) (mcpHTTPProcess, error) {
		if starts.Add(1) == 1 {
			return nil, fmt.Errorf("listen tcp 127.0.0.1:9131: bind: address already in use")
		}
		return newFakeMCPHTTPProcess(), nil
	}
	waitMCPHTTPHealth = func(_ context.Context, _ string, _ mcpHTTPTextLookup) error {
		return nil
	}

	service := newMCPHTTPTestServiceForActiveRoot(t)
	status := service.AIGetMCPHTTPServerStatus()
	if !status.Enabled || !status.Running {
		t.Fatalf("expected restore to succeed after retry, got %#v", status)
	}
	if starts.Load() < 2 {
		t.Fatalf("expected at least two start attempts, got %d", starts.Load())
	}
}

func TestMCPHTTPServerRestartsAfterUnexpectedExit(t *testing.T) {
	originalStarter := startMCPHTTPProcess
	originalHealth := waitMCPHTTPHealth
	t.Cleanup(func() {
		startMCPHTTPProcess = originalStarter
		waitMCPHTTPHealth = originalHealth
	})

	first := newFakeMCPHTTPProcessWithWaitErr(fmt.Errorf("exit status 1"))
	second := newFakeMCPHTTPProcess()
	var starts atomic.Int32
	startMCPHTTPProcess = func(_ context.Context, _ mcpHTTPProcessStartOptions, _ mcpHTTPTextLookup) (mcpHTTPProcess, error) {
		if starts.Add(1) == 1 {
			return first, nil
		}
		return second, nil
	}
	waitMCPHTTPHealth = func(_ context.Context, _ string, _ mcpHTTPTextLookup) error {
		return nil
	}

	service := newMCPHTTPTestService(t)
	if _, err := service.AIStartMCPHTTPServer(ai.MCPHTTPServerOptions{Token: "gnv_restart_token"}); err != nil {
		t.Fatalf("AIStartMCPHTTPServer returned error: %v", err)
	}
	first.finish()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		status := service.AIGetMCPHTTPServerStatus()
		if status.Enabled && status.Running && starts.Load() >= 2 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("expected auto-restart after unexpected exit, starts=%d status=%#v", starts.Load(), service.AIGetMCPHTTPServerStatus())
}

func TestMCPHTTPServerStartFailsWhenHealthComesFromDeadProcess(t *testing.T) {
	originalStarter := startMCPHTTPProcess
	originalHealth := waitMCPHTTPHealth
	t.Cleanup(func() {
		startMCPHTTPProcess = originalStarter
		waitMCPHTTPHealth = originalHealth
	})

	dead := newFakeMCPHTTPProcessWithWaitErr(fmt.Errorf("exit status 1"))
	dead.finish()
	startMCPHTTPProcess = func(_ context.Context, _ mcpHTTPProcessStartOptions, _ mcpHTTPTextLookup) (mcpHTTPProcess, error) {
		return dead, nil
	}
	waitMCPHTTPHealth = func(_ context.Context, _ string, _ mcpHTTPTextLookup) error {
		return nil
	}

	service := newMCPHTTPTestService(t)
	status, err := service.AIStartMCPHTTPServer(ai.MCPHTTPServerOptions{Token: "gnv_dead_health_token"})
	if err == nil {
		t.Fatal("expected start to fail when the subprocess already exited")
	}
	if status.Running {
		t.Fatalf("expected failed start to stay stopped, got %#v", status)
	}
	if !status.Enabled {
		t.Fatalf("expected failed start to keep enabled preference, got %#v", status)
	}
}

func TestWaitMCPHTTPAddrAvailableReturnsWhenPortIsFree(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen returned error: %v", err)
	}
	addr := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := waitMCPHTTPAddrAvailable(ctx, addr, 200*time.Millisecond); err != nil {
		t.Fatalf("waitMCPHTTPAddrAvailable returned error: %v", err)
	}
}
