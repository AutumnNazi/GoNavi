package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type githubClient struct {
	baseURL string
	repo    string
	token   string
	client  *http.Client
}

type reviewComment struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Side string `json:"side"`
	Body string `json:"body"`
}

type issueComment struct {
	ID   int64  `json:"id"`
	Body string `json:"body"`
}

func (g *githubClient) listCheckRuns(ctx context.Context, sha string) ([]checkRun, error) {
	sha = strings.TrimSpace(sha)
	if sha == "" {
		return nil, nil
	}
	var runs []checkRun
	for page := 1; page <= 5; page++ {
		endpoint := fmt.Sprintf("%s/repos/%s/commits/%s/check-runs?per_page=100&page=%d", g.baseURL, g.repo, url.PathEscape(sha), page)
		var payload struct {
			CheckRuns []checkRun `json:"check_runs"`
		}
		if err := g.get(ctx, endpoint, &payload); err != nil {
			return nil, err
		}
		runs = append(runs, payload.CheckRuns...)
		if len(payload.CheckRuns) < 100 {
			break
		}
	}
	return runs, nil
}

// openPullRequest 是 pulls 列表接口里和按 SHA 匹配有关的字段。
type openPullRequest struct {
	Number int        `json:"number"`
	Head   pullBranch `json:"head"`
}

type pullBranch struct {
	Sha string `json:"sha"`
}

// pullRequestForSHA 按 head SHA 找开放中的 PR。workflow_run 事件的
// pull_requests 数组经常为空，只能靠列表匹配；commits/{sha}/pulls 只返回
// 已合并的 PR，对开放 PR 的 head commit 查不到。
func (g *githubClient) pullRequestForSHA(ctx context.Context, sha string) (int, error) {
	sha = strings.TrimSpace(sha)
	var pulls []openPullRequest
	for page := 1; page <= 3; page++ {
		endpoint := fmt.Sprintf("%s/repos/%s/pulls?state=open&per_page=100&page=%d", g.baseURL, g.repo, page)
		var batch []openPullRequest
		if err := g.get(ctx, endpoint, &batch); err != nil {
			return 0, err
		}
		pulls = append(pulls, batch...)
		if len(batch) < 100 {
			break
		}
	}
	for _, pr := range pulls {
		if strings.EqualFold(pr.Head.Sha, sha) {
			return pr.Number, nil
		}
	}
	return 0, nil
}

// pullRequestHead 取 PR 当前 head commit，供 workflow_dispatch 只带 PR 编号时使用。
func (g *githubClient) pullRequestHead(ctx context.Context, pr int) (string, error) {
	endpoint := fmt.Sprintf("%s/repos/%s/pulls/%d", g.baseURL, g.repo, pr)
	var payload struct {
		Head pullBranch `json:"head"`
	}
	if err := g.get(ctx, endpoint, &payload); err != nil {
		return "", err
	}
	return strings.TrimSpace(payload.Head.Sha), nil
}

func (g *githubClient) listFiles(ctx context.Context, pr int) ([]FileChange, error) {
	var files []FileChange
	for page := 1; page <= 10; page++ {
		endpoint := fmt.Sprintf("%s/repos/%s/pulls/%d/files?per_page=100&page=%d", g.baseURL, g.repo, pr, page)
		var batch []FileChange
		if err := g.get(ctx, endpoint, &batch); err != nil {
			return nil, err
		}
		files = append(files, batch...)
		if len(batch) < 100 {
			break
		}
	}
	return files, nil
}

// findComment 返回 PR 里最近的机器人评论；没有则返回 nil。
func (g *githubClient) findComment(ctx context.Context, pr int) (*issueComment, error) {
	endpoint := fmt.Sprintf("%s/repos/%s/issues/%d/comments?per_page=100&sort=created&direction=desc", g.baseURL, g.repo, pr)
	var comments []issueComment
	if err := g.get(ctx, endpoint, &comments); err != nil {
		return nil, err
	}
	for i := range comments {
		if strings.Contains(comments[i].Body, reviewMarker) {
			return &comments[i], nil
		}
	}
	return nil, nil
}

func (g *githubClient) updateComment(ctx context.Context, id int64, body string) error {
	endpoint := fmt.Sprintf("%s/repos/%s/issues/comments/%d", g.baseURL, g.repo, id)
	return g.send(ctx, http.MethodPatch, endpoint, map[string]string{"body": body}, nil)
}

func (g *githubClient) upsertComment(ctx context.Context, pr int, body string) error {
	comment, err := g.findComment(ctx, pr)
	if err != nil {
		return err
	}
	if comment != nil {
		return g.updateComment(ctx, comment.ID, body)
	}
	create := fmt.Sprintf("%s/repos/%s/issues/%d/comments", g.baseURL, g.repo, pr)
	return g.send(ctx, http.MethodPost, create, map[string]string{"body": body}, nil)
}

func (g *githubClient) createReview(ctx context.Context, pr int, sha string, comments []reviewComment) error {
	if len(comments) == 0 {
		return nil
	}
	for i := range comments {
		comments[i].Side = "RIGHT"
	}
	endpoint := fmt.Sprintf("%s/repos/%s/pulls/%d/reviews", g.baseURL, g.repo, pr)
	payload := map[string]any{
		"commit_id": sha,
		"event":     "COMMENT",
		"body":      "行内意见对应汇总评论里的「需要处理」。",
		"comments":  comments,
	}
	return g.send(ctx, http.MethodPost, endpoint, payload, nil)
}

func (g *githubClient) get(ctx context.Context, endpoint string, out any) error {
	return g.send(ctx, http.MethodGet, endpoint, nil, out)
}

func (g *githubClient) send(ctx context.Context, method, endpoint string, payload any, out any) error {
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+g.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "GoNavi-PR-Review")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := g.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("GitHub API %s 返回 HTTP %d", method, resp.StatusCode)
	}
	if out == nil || len(bytes.TrimSpace(raw)) == 0 {
		return nil
	}
	return json.Unmarshal(raw, out)
}

func parseRepo(repo string) (string, error) {
	repo = strings.Trim(strings.TrimSpace(repo), "/")
	owner, name, ok := strings.Cut(repo, "/")
	if !ok || owner == "" || name == "" || strings.Contains(name, "/") {
		return "", fmt.Errorf("仓库名必须是 owner/name")
	}
	return url.PathEscape(owner) + "/" + url.PathEscape(name), nil
}

func parsePRNumber(value string) (int, error) {
	number, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || number <= 0 {
		return 0, fmt.Errorf("PR 编号无效")
	}
	return number, nil
}
