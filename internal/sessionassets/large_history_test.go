package sessionassets

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

// 大文件基准（V-23）拆为两半：本文件覆盖“512 MiB 合成历史的保全提交”
// （领域流式复制+哈希+清单）；分页读取与取消响应的基准见 adapters/codex
// 的 large_page_test.go。
const (
	largeHistoryLineSize = 64 << 10
	largeHistoryTarget   = 512 << 20
	largeHistoryLines    = largeHistoryTarget / largeHistoryLineSize
)

// buildSyntheticRollout 生成指定行数的合成 rollout（每行一条完整 JSON
// 消息，确定性填充，无任何真实会话数据）。
func buildSyntheticRollout(t *testing.T, dir string, lines int) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	path := filepath.Join(dir, "rollout-synthetic.jsonl")
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create synthetic rollout: %v", err)
	}
	pad := strings.Repeat("x", largeHistoryLineSize-80)
	for i := 0; i < lines; i++ {
		if i%2 == 0 {
			fmt.Fprintf(file, "{\"timestamp\":\"t%d\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"%d %s\"}]}}\n", i, i, pad)
		} else {
			fmt.Fprintf(file, "{\"timestamp\":\"t%d\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"%d %s\"}]}}\n", i, i, pad)
		}
	}
	if err := file.Close(); err != nil {
		t.Fatalf("write synthetic rollout: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat synthetic rollout: %v", err)
	}
	if info.Size() < largeHistoryTarget {
		t.Fatalf("synthetic rollout too small: %d bytes", info.Size())
	}
	return path
}

// TestLargeHistoryCaptureBenchmark 是 V-23 的领域基准。常规套件跳过，
// 显式 `go test -run TestLargeHistoryCaptureBenchmark` 触发；结果写入
// 本地台账 v23-benchmark.log。
func TestLargeHistoryCaptureBenchmark(t *testing.T) {
	if testing.Short() {
		t.Skip("large benchmark skipped in -short mode")
	}
	service := newTestService(t)
	ctx := context.Background()
	integrationID, sourceID := enableCodex(t, service)
	source, err := service.catalog.GetSource(ctx, sourceID)
	if err != nil {
		t.Fatalf("load source: %v", err)
	}

	sourceDir := filepath.Join(source.RootPath, "archived_sessions")
	sourcePath := buildSyntheticRollout(t, sourceDir, largeHistoryLines)
	info, err := os.Stat(sourcePath)
	if err != nil {
		t.Fatalf("stat source: %v", err)
	}

	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	started := time.Now()

	session := DiscoveredSession{
		NativeThreadID: "thread-large",
		NativePath:     sourcePath,
		Archived:       true,
		ModifiedAt:     info.ModTime().Unix(),
		Size:           info.Size(),
	}
	if _, err := service.SyncSource(ctx, source, []DiscoveredSession{session}, true); err != nil {
		t.Fatalf("sync: %v", err)
	}
	runQueue(t, service)
	elapsed := time.Since(started)
	runtime.ReadMemStats(&after)

	var asset Asset
	assets, _ := service.catalog.ListAssets(ctx, integrationID)
	for _, item := range assets {
		if item.NativeThreadID == "thread-large" {
			asset = item
		}
	}
	if asset.ID == "" || asset.LatestGenerationID == "" {
		t.Fatalf("large capture did not commit")
	}
	if !asset.LatestComplete || asset.BackupStatus != string(BackupStatusVerified) {
		t.Fatalf("large capture projection wrong: %+v", asset)
	}

	committed := filepath.Join(service.paths.GenerationDir(asset.ID, asset.LatestGenerationID), "raw", "rollout.jsonl")
	committedInfo, err := os.Stat(committed)
	if err != nil {
		t.Fatalf("stat committed copy: %v", err)
	}
	if committedInfo.Size() != info.Size() {
		t.Fatalf("committed size %d != source %d", committedInfo.Size(), info.Size())
	}

	peakCumAlloc := (after.TotalAlloc - before.TotalAlloc) >> 20
	t.Logf("V-23 capture benchmark: size=%d MiB elapsed=%s cumulativeAlloc=%d MiB",
		info.Size()>>20, elapsed, peakCumAlloc)
	recordBenchmarkLine(fmt.Sprintf("V-23 capture: %d MiB, elapsed=%s, cumulativeAlloc=%d MiB, GOOS=%s, date=%s",
		info.Size()>>20, elapsed, peakCumAlloc, runtime.GOOS, time.Now().Format("2006-01-02")))
}

// recordBenchmarkLine 把基准结果追加到本地台账（非开发环境静默跳过）。
func recordBenchmarkLine(line string) {
	f, err := os.OpenFile(filepath.Join("..", "dev-notes", "v23-benchmark.log"),
		os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	_, _ = f.WriteString(line + "\n")
	_ = f.Close()
}
