package aiservice

import (
	"context"
	"net"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/logger"
)

const (
	mcpHTTPAddrWait          = time.Second
	mcpHTTPRestoreRetryDelay = 200 * time.Millisecond
	mcpHTTPMaxCrashRestarts  = 5
	mcpHTTPStableUptime      = 30 * time.Second
)

var (
	mcpHTTPRestoreAttempts   = 5
	mcpHTTPSuperviseRestarts = true
)

func (s *Service) restoreMCPHTTPServer() {
	config := s.currentMCPHTTPServerConfig()
	if !config.Enabled {
		return
	}

	options := mcpHTTPServerOptionsFromConfig(config)
	var lastErr error
	for attempt := 0; attempt < mcpHTTPRestoreAttempts; attempt++ {
		if s.isMCPHTTPShuttingDown() {
			return
		}
		if _, lastErr = s.startMCPHTTPServer(options); lastErr == nil {
			return
		}
		if attempt == mcpHTTPRestoreAttempts-1 {
			break
		}
		time.Sleep(mcpHTTPRestoreRetryDelay)
	}
	logger.Warnf("恢复 GoNavi MCP HTTP 服务失败：addr=%s path=%s reason=%v", config.Addr, config.Path, lastErr)
}

func (s *Service) watchMCPHTTPServer(runtime *mcpHTTPServerRuntime) {
	err := runtime.process.Wait()

	s.mcpHTTPMu.Lock()
	if s.mcpHTTP != runtime {
		s.mcpHTTPMu.Unlock()
		return
	}

	message := localizeMCPHTTPText(s.serviceText, "ai_settings.mcp_http.message.stopped", nil)
	unexpected := err != nil && !runtime.stopping && !s.mcpHTTPShuttingDown
	if unexpected {
		message = localizeMCPHTTPText(s.serviceText, "ai_service.backend.error.mcp_http_process_exited", map[string]any{
			"detail": err.Error(),
		})
		logger.Error(err, "GoNavi MCP HTTP 服务异常退出：addr=%s path=%s", runtime.status.Addr, runtime.status.Path)
	}
	s.mcpHTTP = nil
	s.mcpHTTPLast = stoppedMCPHTTPStatus(runtime.status, message)
	shouldRestart := unexpected && mcpHTTPSuperviseRestarts && s.noteMCPHTTPCrashLocked(runtime.status)
	s.mcpHTTPMu.Unlock()

	if !shouldRestart || !s.currentMCPHTTPServerConfig().Enabled {
		return
	}
	go s.restoreMCPHTTPServer()
}

func (s *Service) markMCPHTTPShuttingDown() {
	s.mcpHTTPMu.Lock()
	s.mcpHTTPShuttingDown = true
	s.mcpHTTPMu.Unlock()
}

func (s *Service) isMCPHTTPShuttingDown() bool {
	s.mcpHTTPMu.Lock()
	defer s.mcpHTTPMu.Unlock()
	return s.mcpHTTPShuttingDown
}

func (s *Service) resetMCPHTTPCrashCount() {
	s.mcpHTTPMu.Lock()
	s.mcpHTTPCrashCount = 0
	s.mcpHTTPMu.Unlock()
}

func (s *Service) noteMCPHTTPCrashLocked(status ai.MCPHTTPServerStatus) bool {
	if status.StartedAt > 0 {
		startedAt := time.UnixMilli(status.StartedAt)
		if time.Since(startedAt) >= mcpHTTPStableUptime {
			s.mcpHTTPCrashCount = 0
		}
	}
	s.mcpHTTPCrashCount++
	if s.mcpHTTPCrashCount > mcpHTTPMaxCrashRestarts {
		logger.Warnf("GoNavi MCP HTTP 服务连续异常退出 %d 次，停止自动拉起：addr=%s path=%s", s.mcpHTTPCrashCount, status.Addr, status.Path)
		return false
	}
	return true
}

func waitMCPHTTPAddrAvailable(ctx context.Context, addr string, timeout time.Duration) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if timeout <= 0 {
		timeout = time.Millisecond
	}
	deadline := time.Now().Add(timeout)
	var lastErr error
	for {
		if err := ctx.Err(); err != nil {
			if lastErr != nil {
				return lastErr
			}
			return err
		}
		listener, err := net.Listen("tcp", addr)
		if err == nil {
			_ = listener.Close()
			return nil
		}
		lastErr = err
		if !time.Now().Before(deadline) {
			return lastErr
		}
		timer := time.NewTimer(100 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			if lastErr != nil {
				return lastErr
			}
			return ctx.Err()
		case <-timer.C:
		}
	}
}
