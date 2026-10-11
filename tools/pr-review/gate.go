package main

import (
	"fmt"
	"sort"
	"strings"
)

// gateCheckName 是合并门禁的权威检查，对应 backend-tests.yml 里的 gate job。
// 「三份测试」等细节由该 job 内聚维护，这里只读它的结论，改名时不用同步本文件。
const gateCheckName = "CI Gate"

// botCheckName 是评审机器人自己的检查，与门禁无关，不进明细。
const botCheckName = "Review and reply"

type checkRun struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
}

func gateReport(runs []checkRun) string {
	// check-runs 接口按创建时间倒序返回，首个即最新一次（重跑覆盖旧结论）。
	latest := map[string]checkRun{}
	for _, run := range runs {
		if _, seen := latest[run.Name]; seen {
			continue
		}
		latest[run.Name] = run
	}
	var b strings.Builder
	b.WriteString("### CI 门禁\n\n")
	passed := false
	if gate, ok := latest[gateCheckName]; ok {
		passed = gate.Status == "completed" && gate.Conclusion == "success"
		fmt.Fprintf(&b, "- **%s**：%s\n", gateCheckName, describeCheck(gate))
	} else {
		fmt.Fprintf(&b, "- **%s**：未开始\n", gateCheckName)
	}
	for _, name := range detailCheckNames(latest) {
		fmt.Fprintf(&b, "  - %s：%s\n", name, describeCheck(latest[name]))
	}
	if passed {
		b.WriteString("\n门禁已通过。\n")
	} else {
		b.WriteString("\n门禁未通过。\n")
	}
	return b.String()
}

// detailCheckNames 列出门禁之外各检查的最新状态，不点开 Checks 页就能看到哪份挂了。
func detailCheckNames(latest map[string]checkRun) []string {
	var names []string
	for name := range latest {
		if name == gateCheckName || name == botCheckName {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func describeCheck(run checkRun) string {
	if run.Status != "completed" {
		return "进行中"
	}
	switch run.Conclusion {
	case "success":
		return "成功"
	case "failure":
		return "失败"
	case "cancelled":
		return "已取消"
	case "skipped":
		return "已跳过"
	case "timed_out":
		return "超时"
	case "startup_failure":
		return "启动失败"
	default:
		if run.Conclusion == "" {
			return "进行中"
		}
		return run.Conclusion
	}
}
