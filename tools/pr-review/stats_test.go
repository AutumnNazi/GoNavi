package main

import (
	"strconv"
	"strings"
	"testing"
)

func hunkAdds(n int) string {
	var b strings.Builder
	b.WriteString("@@ -1 +1," + itoa(n) + " @@\n")
	for i := 0; i < n; i++ {
		b.WriteString("+line\n")
	}
	return b.String()
}

func itoa(n int) string {
	return strconv.Itoa(n)
}

func TestComputeDiffStatsSplitsTestAndCoverage(t *testing.T) {
	files := []FileChange{
		{Filename: "internal/db/demo_impl.go", Status: "modified", Additions: 60, Deletions: 5, Patch: hunkAdds(60)},
		{Filename: "internal/db/demo_impl_test.go", Status: "modified", Additions: 30, Deletions: 0, Patch: hunkAdds(30)},
		{Filename: "docs/说明.md", Status: "modified", Additions: 10, Deletions: 1},
		{Filename: "frontend/wailsjs/go/App.js", Status: "modified", Additions: 8, Deletions: 0, Patch: hunkAdds(8)},
	}
	stats := computeDiffStats(files)
	if stats.Files != 4 || stats.Additions != 108 || stats.Deletions != 6 {
		t.Fatalf("totals = %#v", stats)
	}
	if stats.CodeAdds != 60 || stats.TestAdds != 30 {
		t.Fatalf("code/test adds = %d/%d", stats.CodeAdds, stats.TestAdds)
	}
	// 测试文件与无补丁文件不做逐行扫描（wailsjs 生成物仍会扫描）。
	if stats.ScannedAdds != 68 {
		t.Fatalf("scanned = %d", stats.ScannedAdds)
	}
	if stats.scale() != "中型" {
		t.Fatalf("scale = %s", stats.scale())
	}
}

func TestDiffStatsScaleBands(t *testing.T) {
	big := diffStats{Additions: 400, Deletions: 200}
	if big.scale() != "大型" {
		t.Fatalf("big = %s", big.scale())
	}
	mid := diffStats{Additions: 300}
	if mid.scale() != "中型" {
		t.Fatalf("mid = %s", mid.scale())
	}
}

func TestRenderCommentIncludesStatsBeforeGate(t *testing.T) {
	body := renderComment(reviewReport{
		stats: renderStatsSection(diffStats{Files: 1, Additions: 3}, nil, localeSyncInfo{}, ""),
		gate:  gateReport(nil),
	})
	statsAt := strings.Index(body, "### 变更概览")
	gateAt := strings.Index(body, "### CI 门禁")
	if statsAt < 0 || gateAt < statsAt {
		t.Fatalf("stats should precede gate:\n%s", body)
	}
	if !strings.Contains(body, "没有发现") {
		t.Fatalf("clean message should remain:\n%s", body)
	}
}

func TestRenderStatsSectionShowsPercentages(t *testing.T) {
	files := []FileChange{
		{Filename: "internal/db/demo_impl.go", Status: "modified", Additions: 60, Deletions: 5, Patch: hunkAdds(60)},
		{Filename: "internal/db/demo_impl_test.go", Status: "modified", Additions: 30, Deletions: 0, Patch: hunkAdds(30)},
		{Filename: "shared/i18n/zh-CN.json", Status: "modified", Additions: 2},
	}
	findings := []Finding{
		{Path: "a.go", Severity: severityError, Rule: "panic-in-runtime", Message: "不要 panic"},
		{Path: "b.go", Severity: severityWarning, Rule: "model-review", Message: "建议"},
	}
	stats := computeDiffStats(files)
	body := renderStatsSection(stats, findings, localeSync(files), "groq · openai/gpt-oss-120b")
	for _, want := range []string{
		"### 变更概览",
		"3 个文件，+92 / -5",
		"测试行占比：33%",
		"规约扫描覆盖：65%",
		"需要处理 1 · 建议 1",
		"i18n 同步：16%（1/6，缺 de-DE",
		"模型评审：groq · openai/gpt-oss-120b",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %q in:\n%s", want, body)
		}
	}
	if renderStatsSection(diffStats{}, nil, localeSyncInfo{}, "") != "" {
		t.Fatal("empty diff should render nothing")
	}
	noModel := renderStatsSection(stats, nil, localeSyncInfo{}, "")
	if strings.Contains(noModel, "模型评审") {
		t.Fatalf("model line should be hidden when unconfigured:\n%s", noModel)
	}
}
