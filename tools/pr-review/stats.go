package main

import (
	"fmt"
	"strings"
)

// diffStats 汇总一次 diff 的规模、测试占比与扫描覆盖，供变更概览展示。
type diffStats struct {
	Files       int
	Additions   int
	Deletions   int
	CodeAdds    int // 生产源码新增行
	TestAdds    int // 测试文件新增行
	ScannedAdds int // 规约逐行扫描过的新增行（测试、生成物、无补丁文件不计）
}

func computeDiffStats(files []FileChange) diffStats {
	var s diffStats
	for _, file := range files {
		s.Files++
		s.Additions += file.Additions
		s.Deletions += file.Deletions
		switch {
		case isTestFile(file.Filename):
			s.TestAdds += file.Additions
		case isProductionSource(file.Filename):
			s.CodeAdds += file.Additions
		}
		if !skipContentScan(file.Filename) && strings.TrimSpace(file.Patch) != "" {
			s.ScannedAdds += len(addedLines(file.Patch))
		}
	}
	return s
}

// scale 按总变更量分级，提示评审深度的预期。
func (s diffStats) scale() string {
	churn := s.Additions + s.Deletions
	switch {
	case churn < 100:
		return "小型"
	case churn < 500:
		return "中型"
	default:
		return "大型"
	}
}

func isTestFile(filename string) bool {
	return strings.HasSuffix(filename, "_test.go") ||
		strings.HasSuffix(filename, ".test.ts") ||
		strings.HasSuffix(filename, ".test.tsx")
}

func percent(part, total int) int {
	if total <= 0 {
		return 0
	}
	return part * 100 / total
}

// renderStatsSection 渲染「变更概览」段；没有文件变更时返回空。
func renderStatsSection(s diffStats, findings []Finding, sync localeSyncInfo, modelInfo string) string {
	if s.Files == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("### 变更概览\n\n")
	fmt.Fprintf(&b, "- 变更规模：%d 个文件，+%d / -%d（%s变更）\n", s.Files, s.Additions, s.Deletions, s.scale())
	if s.CodeAdds+s.TestAdds > 0 {
		fmt.Fprintf(&b, "- 测试行占比：%d%%（测试 +%d / 源码 +%d）\n",
			percent(s.TestAdds, s.CodeAdds+s.TestAdds), s.TestAdds, s.CodeAdds)
	}
	fmt.Fprintf(&b, "- 规约扫描覆盖：%d%%（逐行扫描 %d / 新增 %d，测试与生成文件只做文件级检查）\n",
		percent(s.ScannedAdds, s.Additions), s.ScannedAdds, s.Additions)
	errors, warnings := splitFindings(findings)
	fmt.Fprintf(&b, "- 规约命中：需要处理 %d · 建议 %d\n", len(errors), len(warnings))
	if sync.involved {
		synced := len(localeFiles) - len(sync.missing)
		if len(sync.missing) == 0 {
			fmt.Fprintf(&b, "- i18n 同步：100%%（%d/%d 语言已更新）\n", synced, len(localeFiles))
		} else {
			fmt.Fprintf(&b, "- i18n 同步：%d%%（%d/%d，缺 %s）\n",
				percent(synced, len(localeFiles)), synced, len(localeFiles), strings.Join(sync.missing, "、"))
		}
	}
	if modelInfo != "" {
		fmt.Fprintf(&b, "- 模型评审：%s\n", modelInfo)
	}
	return b.String()
}
