package provider

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const grokCLIUpstreamGiveUpRepeats = 3

// grokCLIUpstreamPollInterval is how often a running grok process is checked
// for silent upstream retries. Tests shorten it.
var grokCLIUpstreamPollInterval = 400 * time.Millisecond

// grokCLIUpstreamState 记录同一个进程在日志里重复出现的上游失败。
// 「无可用渠道」这类错误重试也不会恢复，连续出现几次就该把原文交给用户，
// 而不是干等标准输出，直到空闲超时把进程杀掉。
type grokCLIUpstreamState struct {
	message string
	repeats int
	gaveUp  bool
}

func (s *grokCLIUpstreamState) observe(message string, retry bool) (activity bool, giveUp bool) {
	message = grokCLIUpstreamUserMessage(message)
	if message == "" || s.gaveUp {
		return false, false
	}
	if message == s.message {
		s.repeats++
	} else {
		s.message = message
		s.repeats = 1
	}
	if !retry || (grokCLIUpstreamUnavailable(message) && s.repeats >= grokCLIUpstreamGiveUpRepeats) {
		s.gaveUp = true
		return true, true
	}
	return true, false
}

func grokCLIUpstreamUnavailable(message string) bool {
	lower := strings.ToLower(message)
	return strings.Contains(message, "无可用渠道") || strings.Contains(lower, "no available channel")
}

func grokCLIUpstreamUserMessage(message string) string {
	message = strings.TrimSpace(message)
	if index := strings.Index(message, "one_hub_error:"); index >= 0 {
		message = strings.TrimSpace(message[index+len("one_hub_error:"):])
	}
	if index := strings.Index(message, "(request id:"); index >= 0 {
		message = strings.TrimSpace(message[:index])
	}
	return strings.TrimSpace(message)
}

type grokCLILogHit struct {
	pid     int
	message string
	retry   bool
}

func grokCLIUpstreamFromLogLine(line string) (grokCLILogHit, bool) {
	var event struct {
		PID int    `json:"pid"`
		Msg string `json:"msg"`
		Ctx struct {
			Message string `json:"message"`
			Reason  string `json:"reason"`
		} `json:"ctx"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &event); err != nil || event.PID == 0 {
		return grokCLILogHit{}, false
	}
	switch event.Msg {
	case "shell.turn.inference_retry":
		text := event.Ctx.Reason
		if text == "" {
			text = event.Ctx.Message
		}
		return grokCLILogHit{pid: event.PID, message: text, retry: true}, text != ""
	case "shell.turn.inference_failed":
		return grokCLILogHit{pid: event.PID, message: event.Ctx.Message, retry: false}, event.Ctx.Message != ""
	default:
		return grokCLILogHit{}, false
	}
}

type grokCLIUpstreamWatch struct {
	mu        sync.Mutex
	state     grokCLIUpstreamState
	stopped   chan struct{}
	started   chan struct{}
	closeOnce sync.Once
	startOnce sync.Once
}

func (w *grokCLIUpstreamWatch) giveUpMessage() string {
	if w == nil {
		return ""
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.state.gaveUp {
		return ""
	}
	return w.state.message
}

func (w *grokCLIUpstreamWatch) lastMessage() string {
	if w == nil {
		return ""
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.state.message
}

func grokCLILogPathForEnv(env []string) string {
	if home := strings.TrimSpace(envValue(env, "GROK_HOME")); home != "" {
		return filepath.Join(home, "logs", "unified.jsonl")
	}
	return grokCLIUnifiedLogPath()
}

func (w *grokCLIUpstreamWatch) close() {
	if w == nil {
		return
	}
	w.closeOnce.Do(func() {
		close(w.stopped)
	})
}

func grokCLIUnifiedLogPath() string {
	if home := strings.TrimSpace(os.Getenv("GROK_HOME")); home != "" {
		return filepath.Join(home, "logs", "unified.jsonl")
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".grok", "logs", "unified.jsonl")
}

// startGrokCLIUpstreamWatch tails grok's own log for this process. Stdout stays
// quiet while grok retries a dead upstream, which otherwise trips the idle watchdog.
func startGrokCLIUpstreamWatch(pid int, onActivity func(), onGiveUp func()) *grokCLIUpstreamWatch {
	return startGrokCLIUpstreamWatchAt(grokCLIUnifiedLogPath(), pid, onActivity, onGiveUp)
}

func startGrokCLIUpstreamWatchAt(path string, pid int, onActivity func(), onGiveUp func()) *grokCLIUpstreamWatch {
	watch := &grokCLIUpstreamWatch{
		stopped: make(chan struct{}),
		started: make(chan struct{}),
	}
	if pid <= 0 || strings.TrimSpace(path) == "" {
		watch.markStarted()
		watch.close()
		return watch
	}
	go watch.loop(path, pid, onActivity, onGiveUp)
	return watch
}

func (w *grokCLIUpstreamWatch) markStarted() {
	w.startOnce.Do(func() {
		close(w.started)
	})
}

func (w *grokCLIUpstreamWatch) loop(path string, pid int, onActivity func(), onGiveUp func()) {
	defer w.close()
	defer w.markStarted()
	ticker := time.NewTicker(grokCLIUpstreamPollInterval)
	defer ticker.Stop()
	var file *os.File
	var offset int64
	var pending string
	defer func() {
		if file != nil {
			_ = file.Close()
		}
	}()
	for {
		select {
		case <-w.stopped:
			return
		case <-ticker.C:
			if file == nil {
				opened, err := os.Open(path)
				if err != nil {
					continue
				}
				file = opened
				offset, err = file.Seek(0, io.SeekEnd)
				if err != nil {
					return
				}
				w.markStarted()
			}
			next, chunk, readErr := readGrokCLILogAppend(file, offset)
			offset = next
			if readErr != nil && readErr != io.EOF {
				return
			}
			if chunk == "" {
				continue
			}
			pending += chunk
			lines := strings.Split(pending, "\n")
			pending = lines[len(lines)-1]
			for _, line := range lines[:len(lines)-1] {
				if w.consume(line, pid, onActivity, onGiveUp) {
					return
				}
			}
		}
	}
}

func (w *grokCLIUpstreamWatch) consume(line string, pid int, onActivity func(), onGiveUp func()) bool {
	hit, ok := grokCLIUpstreamFromLogLine(line)
	if !ok || hit.pid != pid {
		return false
	}
	w.mu.Lock()
	activity, giveUp := w.state.observe(hit.message, hit.retry)
	w.mu.Unlock()
	if activity && onActivity != nil {
		onActivity()
	}
	if !giveUp {
		return false
	}
	if onGiveUp != nil {
		onGiveUp()
	}
	return true
}

func readGrokCLILogAppend(file *os.File, offset int64) (int64, string, error) {
	info, err := file.Stat()
	if err != nil {
		return offset, "", err
	}
	if info.Size() < offset {
		offset = 0
	}
	if info.Size() == offset {
		return offset, "", nil
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return offset, "", err
	}
	reader := bufio.NewReader(file)
	var builder strings.Builder
	for {
		part, err := reader.ReadString('\n')
		builder.WriteString(part)
		if err != nil {
			return offset + int64(builder.Len()), builder.String(), err
		}
	}
}
