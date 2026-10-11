package main

import "testing"

func TestAddedLinesMapsNewFileLineNumbers(t *testing.T) {
	patch := "@@ -10,3 +12,4 @@ func Query()\n context\n-old\n+added one\n+added two\n context\n"
	lines := addedLines(patch)
	if len(lines) != 2 || lines[0].Line != 13 || lines[0].Text != "added one" || lines[1].Line != 14 {
		t.Fatalf("added lines = %#v", lines)
	}
}

func TestReviewFilesFlagsForbiddenGrowthAndSkipsNetZero(t *testing.T) {
	grown := reviewFiles([]FileChange{{
		Filename:  "frontend/src/components/QueryEditor.tsx",
		Status:    "modified",
		Additions: 4,
		Deletions: 1,
		Patch:     "@@ -1,1 +1,2 @@\n keep\n+more\n",
	}})
	if !hasRule(grown, "forbidden-file-growth") || grown[0].Line != 2 {
		t.Fatalf("grown = %#v", grown)
	}
	same := reviewFiles([]FileChange{{
		Filename:  "internal/app/app.go",
		Status:    "modified",
		Additions: 2,
		Deletions: 2,
		Patch:     "@@ -1 +1 @@\n-old\n+new\n",
	}})
	if hasRule(same, "forbidden-file-growth") {
		t.Fatalf("balanced edit should pass, got %#v", same)
	}
}

func TestReviewFilesFlagsSecretsUITextPanicAndLocales(t *testing.T) {
	findings := reviewFiles([]FileChange{
		{
			Filename: "internal/db/demo_impl.go",
			Status:   "modified",
			Patch:    "@@ -1,1 +1,3 @@\n keep\n+panic(\"bad\")\n+password := \"s3cr3t-value\"\n",
		},
		{
			Filename: "frontend/src/components/Panel.tsx",
			Status:   "modified",
			Patch:    "@@ -1 +2 @@\n keep\n+const title = \"设置\"\n",
		},
		{
			Filename: "shared/i18n/zh-CN.json",
			Status:   "modified",
			Patch:    "@@ -1 +1 @@\n+{}\n",
		},
		{
			Filename:  "frontend/src/newFeature.tsx",
			Status:    "added",
			Additions: 801,
		},
		{
			Filename:  "frontend/wailsjs/go/models.ts",
			Status:    "modified",
			Additions: 2,
		},
	})
	for _, rule := range []string{"panic-in-runtime", "secret-in-diff", "hardcoded-ui-text", "i18n-locale-drift", "file-too-long", "wailsjs-generated"} {
		if !hasRule(findings, rule) {
			t.Fatalf("missing %s in %#v", rule, findings)
		}
	}
	if reviewFiles([]FileChange{{
		Filename: "internal/db/demo_impl_test.go",
		Patch:    "@@ -1 +1 @@\n+panic(\"fixture\")\n",
	}}) != nil {
		t.Fatal("tests should not be scanned for panic")
	}
	if looksLikeSecret(`password := "example-secret"`) {
		t.Fatal("placeholder password should not be treated as a leak")
	}
}

func TestRenderCommentAndInlineComments(t *testing.T) {
	findings := []Finding{
		{Path: "a.go", Line: 3, Severity: severityError, Rule: "panic-in-runtime", Message: "不要 panic"},
		{Path: "b.tsx", Line: 4, Severity: severityWarning, Rule: "hardcoded-ui-text", Message: "走 i18n"},
	}
	body := renderComment(reviewReport{findings: findings, modelSummary: "看起来还有一个空指针。"})
	if !containsAll(body, reviewMarker, "需要处理", "建议", "模型评审", "a.go", "b.tsx") {
		t.Fatalf("comment = %s", body)
	}
	comments := inlineComments(findings)
	if len(comments) != 1 || comments[0].Path != "a.go" || comments[0].Line != 3 {
		t.Fatalf("inline = %#v", comments)
	}
	empty := renderComment(reviewReport{})
	if empty == "" || !containsAll(empty, "没有发现") {
		t.Fatal("empty review should still reply")
	}
}

func TestRenderCommentShowsModelFailureNotice(t *testing.T) {
	body := renderComment(reviewReport{modelNotice: "模型评审本次不可用：groq: 模型接口返回 HTTP 404"})
	if !containsAll(body, "模型评审", "HTTP 404") {
		t.Fatalf("notice = %s", body)
	}
	if contains(body, "没有发现") {
		t.Fatal("notice should replace the clean message")
	}
}

func TestGateReportFollowsCIGateCheck(t *testing.T) {
	// 列表按创建时间倒序，首个 CI Gate 即最新一次。
	retrying := gateReport([]checkRun{
		{Name: "Full backend suite", Status: "completed", Conclusion: "success"},
		{Name: "Platform-sensitive tests (macos-latest)", Status: "completed", Conclusion: "success"},
		{Name: "Platform-sensitive tests (windows-latest)", Status: "in_progress"},
		{Name: gateCheckName, Status: "in_progress"},
		{Name: gateCheckName, Status: "completed", Conclusion: "failure"},
	})
	if !containsAll(retrying, "**CI Gate**：进行中", "门禁未通过", "(windows-latest)：进行中") {
		t.Fatalf("retrying gate = %s", retrying)
	}
	failed := gateReport([]checkRun{
		{Name: gateCheckName, Status: "completed", Conclusion: "failure"},
	})
	if !containsAll(failed, "**CI Gate**：失败", "门禁未通过") {
		t.Fatalf("failed gate = %s", failed)
	}
	closed := gateReport([]checkRun{
		{Name: "Full backend suite", Status: "completed", Conclusion: "success"},
		{Name: "Platform-sensitive tests (macos-latest)", Status: "completed", Conclusion: "success"},
		{Name: "Platform-sensitive tests (windows-latest)", Status: "completed", Conclusion: "success"},
		{Name: botCheckName, Status: "completed", Conclusion: "success"},
		{Name: gateCheckName, Status: "completed", Conclusion: "success"},
	})
	if !containsAll(closed, "门禁已通过", "**CI Gate**：成功", "Full backend suite：成功") ||
		contains(closed, botCheckName) || contains(closed, "门禁未通过") {
		t.Fatalf("closed gate = %s", closed)
	}
	missing := gateReport([]checkRun{
		{Name: "Full backend suite", Status: "completed", Conclusion: "success"},
	})
	if !containsAll(missing, "**CI Gate**：未开始", "门禁未通过", "Full backend suite：成功") {
		t.Fatalf("missing gate = %s", missing)
	}
}

func TestRefreshGateSectionReplacesOnlyGate(t *testing.T) {
	old := renderComment(reviewReport{
		findings:     []Finding{{Path: "a.go", Line: 3, Severity: severityError, Rule: "panic-in-runtime", Message: "不要 panic"}},
		modelSummary: "模型还有一处空指针。",
		gate:         gateReport([]checkRun{{Name: gateCheckName, Status: "in_progress"}}),
	})
	updated, ok := refreshGateSection(old, gateReport([]checkRun{
		{Name: gateCheckName, Status: "completed", Conclusion: "success"},
	}))
	if !ok {
		t.Fatal("gate section should be recognized")
	}
	if !containsAll(updated, "门禁已通过", "不要 panic", "模型还有一处空指针。") {
		t.Fatalf("updated = %s", updated)
	}
	if contains(updated, "进行中") {
		t.Fatalf("stale gate status survived: %s", updated)
	}
	if body, ok := refreshGateSection(old+"\n尾部补丁\n", gateReport(nil)); !ok || !contains(body, "尾部补丁") {
		t.Fatalf("trailing content should survive, ok=%v body=%s", ok, body)
	}
	if _, ok := refreshGateSection("随手写的评论", gateReport(nil)); ok {
		t.Fatal("comment without gate heading should not be spliced")
	}
}

func hasRule(findings []Finding, rule string) bool {
	for _, finding := range findings {
		if finding.Rule == rule {
			return true
		}
	}
	return false
}

func containsAll(body string, parts ...string) bool {
	for _, part := range parts {
		if !contains(body, part) {
			return false
		}
	}
	return true
}

func contains(body, part string) bool {
	return len(part) == 0 || (len(body) >= len(part) && (body == part || len(body) > 0 && stringIndex(body, part) >= 0))
}

func stringIndex(body, part string) int {
	for i := 0; i+len(part) <= len(body); i++ {
		if body[i:i+len(part)] == part {
			return i
		}
	}
	return -1
}
