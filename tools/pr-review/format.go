package main

import (
	"fmt"
	"strings"
)

// gateHeading 和 commentFooter 是评论里门禁段的定位锚点，
// refreshGateSection 靠它们只替换门禁状态、保留已有评审内容。
const (
	gateHeading   = "### CI 门禁"
	commentFooter = "规约意见不会代替 CI 门禁。这条评论会在后续推送和测试完成后更新。"
)

// reviewReport 汇总一条评审评论的全部素材。
type reviewReport struct {
	stats        string // 渲染好的「变更概览」段；空则不展示
	findings     []Finding
	modelSummary string
	modelNotice  string
	gate         string
}

func renderComment(report reviewReport) string {
	var b strings.Builder
	b.WriteString(reviewMarker)
	b.WriteString("\n\n")
	if report.stats != "" {
		b.WriteString(report.stats)
		b.WriteString("\n")
	}
	if len(report.findings) == 0 && strings.TrimSpace(report.modelSummary) == "" && strings.TrimSpace(report.modelNotice) == "" {
		b.WriteString("对照仓库规约看过这次 diff，没有发现需要处理的问题。\n")
	} else {
		errors, warnings := splitFindings(report.findings)
		writeFindingSection(&b, "需要处理", errors)
		writeFindingSection(&b, "建议", warnings)
		if summary := strings.TrimSpace(report.modelSummary); summary != "" {
			b.WriteString("### 模型评审\n\n")
			b.WriteString(summary)
			if !strings.HasSuffix(summary, "\n") {
				b.WriteString("\n")
			}
		} else if notice := strings.TrimSpace(report.modelNotice); notice != "" {
			// 模型失败要在评论里自曝，避免语义评审静默失效没人发现。
			b.WriteString("### 模型评审\n\n")
			b.WriteString("> " + notice + "\n")
		}
	}
	if gate := strings.TrimSpace(report.gate); gate != "" {
		b.WriteString(gateBlock(gate))
	}
	b.WriteString(commentFooter + "\n")
	return b.String()
}

// gateBlock 是门禁段的完整文本：前后空行包住，方便整体替换。
func gateBlock(gateSummary string) string {
	return "\n" + strings.TrimRight(gateSummary, "\n") + "\n\n"
}

// refreshGateSection 把旧评论里的门禁段换成最新状态，评审意见原样保留。
// 评论没有门禁段（老版本或被手工改过）时返回 false，由调用方走全量覆盖。
func refreshGateSection(body, gateSummary string) (string, bool) {
	start := strings.Index(body, gateHeading)
	if start < 0 {
		return body, false
	}
	end := strings.Index(body[start:], commentFooter)
	if end < 0 {
		return body, false
	}
	end += start
	return body[:start] + strings.TrimLeft(gateBlock(gateSummary), "\n") + body[end:], true
}

func splitFindings(findings []Finding) (errors, warnings []Finding) {
	for _, finding := range findings {
		if finding.blocks() {
			errors = append(errors, finding)
			continue
		}
		warnings = append(warnings, finding)
	}
	return errors, warnings
}

func writeFindingSection(b *strings.Builder, title string, findings []Finding) {
	if len(findings) == 0 {
		return
	}
	fmt.Fprintf(b, "### %s\n\n", title)
	limit := len(findings)
	if limit > 30 {
		limit = 30
	}
	for _, finding := range findings[:limit] {
		fmt.Fprintf(b, "- `%s`：%s\n", finding.Path, finding.Message)
	}
	if len(findings) > limit {
		fmt.Fprintf(b, "- 其余 %d 条省略，请看工作流日志。\n", len(findings)-limit)
	}
	b.WriteString("\n")
}

func inlineComments(findings []Finding) []reviewComment {
	var comments []reviewComment
	seen := map[string]struct{}{}
	for _, finding := range findings {
		if finding.Line <= 0 || finding.Path == "" || !finding.blocks() {
			continue
		}
		key := fmt.Sprintf("%s:%d:%s", finding.Path, finding.Line, finding.Rule)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		comments = append(comments, reviewComment{
			Path: finding.Path,
			Line: finding.Line,
			Body: finding.Message,
		})
		if len(comments) == 10 {
			break
		}
	}
	return comments
}

func hasBlockingFinding(findings []Finding) bool {
	for _, finding := range findings {
		if finding.blocks() {
			return true
		}
	}
	return false
}
