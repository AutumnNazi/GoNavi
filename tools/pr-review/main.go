package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	repoFlag := flag.String("repo", os.Getenv("GITHUB_REPOSITORY"), "owner/name")
	prFlag := flag.String("pr", "", "pull request number")
	shaFlag := flag.String("sha", "", "head commit SHA")
	gateOnlyFlag := flag.Bool("gate-only", false, "只刷新评论里的 CI 门禁状态，不再调模型")
	flag.Parse()

	if err := run(context.Background(), *repoFlag, *prFlag, *shaFlag, *gateOnlyFlag, os.Getenv); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
}

func run(ctx context.Context, repoName, prText, sha string, gateOnly bool, env func(string) string) error {
	repo, err := parseRepo(repoName)
	if err != nil {
		return err
	}
	token := strings.TrimSpace(env("GITHUB_TOKEN"))
	if token == "" {
		return fmt.Errorf("缺少 GITHUB_TOKEN")
	}
	client := &githubClient{
		baseURL: "https://api.github.com",
		repo:    repo,
		token:   token,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
	sha = strings.TrimSpace(sha)
	pr, err := resolvePullRequest(ctx, client, prText, sha)
	if err != nil {
		return err
	}
	if pr == 0 {
		fmt.Fprintln(os.Stderr, "这个提交没有对应的 pull request，跳过回复")
		return nil
	}
	// 只带 PR 编号的场景（workflow_dispatch）没有 SHA，取当前 head。
	if sha == "" {
		sha, err = client.pullRequestHead(ctx, pr)
		if err != nil {
			return err
		}
	}
	files, err := client.listFiles(ctx, pr)
	if err != nil {
		return err
	}
	findings := reviewFiles(files)
	modelSummary := ""
	modelNotice := ""
	modelInfo := "未配置语义模型"
	if !gateOnly {
		summary, modelFindings, modelLabel, modelErr := reviewWithFreeModels(ctx, nil, env, files)
		if modelErr != nil {
			// 失败写进评论自曝，避免语义评审静默失效。
			modelNotice = "模型评审本次不可用：" + clipText(modelErr.Error(), 300)
			modelInfo = ""
			fmt.Fprintf(os.Stderr, "模型评审跳过：%v\n", modelErr)
		} else if modelLabel != "" {
			modelSummary = summary
			modelInfo = modelLabel
			findings = append(findings, modelFindings...)
		}
	} else {
		// gate-only 不重跑模型，概览里不提模型。
		modelInfo = ""
	}
	checks, err := client.listCheckRuns(ctx, sha)
	if err != nil {
		return err
	}
	gate := gateReport(checks)
	if gateOnly {
		if err := refreshGateOnly(ctx, client, pr, gate); err != nil {
			return err
		}
		return nil
	}
	body := renderComment(reviewReport{
		stats:        renderStatsSection(computeDiffStats(files), findings, localeSync(files), modelInfo),
		findings:     findings,
		modelSummary: modelSummary,
		modelNotice:  modelNotice,
		gate:         gate,
	})
	if err := client.upsertComment(ctx, pr, body); err != nil {
		return err
	}
	if err := client.createReview(ctx, pr, sha, inlineComments(findings)); err != nil {
		fmt.Fprintf(os.Stderr, "行内评论未发表：%v\n", err)
	}
	return nil
}

// refreshGateOnly 更新已有评论的门禁段，保留此前的评审意见；
// 没有旧评论或旧评论认不出结构时，退回全量渲染（diff 未变，规约结论相同）。
func refreshGateOnly(ctx context.Context, client *githubClient, pr int, gate string) error {
	comment, err := client.findComment(ctx, pr)
	if err != nil {
		return err
	}
	if comment != nil {
		if body, ok := refreshGateSection(comment.Body, gate); ok {
			return client.updateComment(ctx, comment.ID, body)
		}
	}
	files, err := client.listFiles(ctx, pr)
	if err != nil {
		return err
	}
	findings := reviewFiles(files)
	return client.upsertComment(ctx, pr, renderComment(reviewReport{
		stats:    renderStatsSection(computeDiffStats(files), findings, localeSync(files), ""),
		findings: findings,
		gate:     gate,
	}))
}

func resolvePullRequest(ctx context.Context, client *githubClient, prText, sha string) (int, error) {
	if strings.TrimSpace(prText) != "" {
		return parsePRNumber(prText)
	}
	if sha == "" {
		return 0, fmt.Errorf("缺少 PR 编号或提交 SHA")
	}
	return client.pullRequestForSHA(ctx, sha)
}
