package codex

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// 大文件分页基准（V-23 读取面）：512 MiB 合成历史的深偏移分页、内存
// 恒定与取消响应。显式 `-run TestLargeHistoryPagedRead` 触发。
func TestLargeHistoryPagedRead(t *testing.T) {
	if testing.Short() {
		t.Skip("large benchmark skipped in -short mode")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "rollout-synthetic.jsonl")
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	pad := strings.Repeat("x", 64<<10-80)
	lines := (512 << 20) / (64 << 10)
	for i := 0; i < lines; i++ {
		role := "user"
		field := "input_text"
		if i%2 == 1 {
			role = "assistant"
			field = "output_text"
		}
		fmt.Fprintf(file, "{\"timestamp\":\"t%d\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"%s\",\"content\":[{\"type\":\"%s\",\"text\":\"%d %s\"}]}}\n", i, role, field, i, pad)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("write: %v", err)
	}

	// 深偏移分页：耗时受页大小而非文件大小支配。
	pageStart := time.Now()
	page, err := ReadHistoryPage(context.Background(), path, lines-10, 20)
	pageElapsed := time.Since(pageStart)
	if err != nil {
		t.Fatalf("deep paged read: %v", err)
	}
	if len(page.Entries) == 0 {
		t.Fatalf("deep paged read returned no entries")
	}

	// 取消响应：已取消的 ctx 必须立即返回。
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	cancelStart := time.Now()
	if _, err := ReadHistoryPage(cancelled, path, 0, 50); err == nil {
		t.Fatalf("cancelled read must return an error")
	}
	cancelElapsed := time.Since(cancelStart)
	if cancelElapsed > 2*time.Second {
		t.Fatalf("cancelled read too slow: %s", cancelElapsed)
	}

	t.Logf("V-23 paged-read benchmark: lines=%d deepPage=%s cancelReturn=%s",
		lines, pageElapsed, cancelElapsed)
	recordPageBenchmark(fmt.Sprintf("V-23 paged-read: lines=%d, deepPage=%s, cancelReturn=%s, GOOS=%s, date=%s",
		lines, pageElapsed, cancelElapsed, runtime.GOOS, time.Now().Format("2006-01-02")))
}

func recordPageBenchmark(line string) {
	f, err := os.OpenFile(filepath.Join("..", "..", "..", "dev-notes", "v23-benchmark.log"),
		os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	_, _ = f.WriteString(line + "\n")
	_ = f.Close()
}
