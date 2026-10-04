package db

import (
	"bytes"
	"net/http"
	"regexp"
	"strings"
)

// 控制台命令识别不依赖驱动代理：app 层按它区分 Meilisearch 的读写请求（只读保护、审计与 DBQuery 分流）。

// meilisearchRESTRequest 是控制台里「METHOD /path，换行后跟 JSON 请求体」形式的一个 REST 请求。
type meilisearchRESTRequest struct {
	method string
	path   string
	body   []byte
}

var meilisearchRESTLine = regexp.MustCompile(`^(?i)(GET|HEAD|POST|PUT|PATCH|DELETE)\s+(/\S*)\s*$`)

// meilisearchReadPaths 是 POST 但只读的接口：搜索、多索引搜索、分面搜索、相似文档与按条件取文档。
var meilisearchReadPaths = regexp.MustCompile(`^/(multi-search|indexes/[^/]+/(search|facet-search|similar|documents/fetch))/?$`)

// parseMeilisearchRESTRequests 解析一段 REST 请求：每个以「METHOD /path」开头的行开始一个请求，
// 之后到下一个请求行之间的内容是 JSON 请求体（建表语句页给出的脚本即是多个请求）。不是 REST 文本时返回 false。
func parseMeilisearchRESTRequests(text string) ([]meilisearchRESTRequest, bool) {
	lines := strings.Split(strings.TrimSpace(strings.ReplaceAll(text, "\r\n", "\n")), "\n")
	requests := make([]meilisearchRESTRequest, 0, 1)
	var body []string
	flush := func() {
		if len(requests) == 0 {
			return
		}
		if trimmed := bytes.TrimSpace([]byte(strings.Join(body, "\n"))); len(trimmed) > 0 {
			requests[len(requests)-1].body = trimmed
		}
		body = body[:0]
	}
	for _, line := range lines {
		if match := meilisearchRESTLine.FindStringSubmatch(strings.TrimSpace(line)); match != nil {
			flush()
			requests = append(requests, meilisearchRESTRequest{method: strings.ToUpper(match[1]), path: match[2]})
			continue
		}
		if len(requests) == 0 {
			if strings.TrimSpace(line) == "" {
				continue
			}
			return nil, false
		}
		body = append(body, line)
	}
	flush()
	return requests, len(requests) > 0
}

// isRead 报告请求是否只读。
func (r meilisearchRESTRequest) isRead() bool {
	switch r.method {
	case http.MethodGet, http.MethodHead:
		return true
	case http.MethodPost:
		path, _, _ := strings.Cut(r.path, "?")
		return meilisearchReadPaths.MatchString(path)
	}
	return false
}

// IsMeilisearchReadCommand 报告控制台文本是否只读：SELECT、GET / HEAD 与搜索类 POST。
func IsMeilisearchReadCommand(text string) bool {
	trimmed := strings.TrimSpace(text)
	if requests, ok := parseMeilisearchRESTRequests(trimmed); ok {
		for _, request := range requests {
			if !request.isRead() {
				return false
			}
		}
		return true
	}
	return strings.HasPrefix(strings.ToLower(trimmed), "select")
}
