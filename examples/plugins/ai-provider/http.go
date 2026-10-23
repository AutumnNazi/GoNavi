package main

import (
	"bytes"
	"context"
	"encoding/json"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

const responseHeaderTimeout = 15 * time.Second

type httpProvider struct{ client *http.Client }

type upstreamRequest struct {
	Model         string                     `json:"model"`
	Messages      []plugin.AIProviderMessage `json:"messages"`
	Temperature   float64                    `json:"temperature"`
	MaxTokens     int                        `json:"max_tokens"`
	Tools         []plugin.AIProviderTool    `json:"tools,omitempty"`
	N             int                        `json:"n"`
	Stream        bool                       `json:"stream"`
	StreamOptions struct {
		IncludeUsage bool `json:"include_usage"`
	} `json:"stream_options"`
}

func newHTTPProvider() *httpProvider {
	// Own the transport instead of inheriting environment proxies or shared defaults.
	transport := &http.Transport{
		Proxy: nil,
		DialContext: (&net.Dialer{
			Timeout: 10 * time.Second, KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:    10 * time.Second,
		ResponseHeaderTimeout:  responseHeaderTimeout,
		MaxResponseHeaderBytes: 32 << 10,
		MaxConnsPerHost:        16,
		DisableCompression:     true,
		// Fresh connections also avoid transparent replay on stale pooled connections.
		DisableKeepAlives: true,
	}
	return &httpProvider{client: &http.Client{
		Transport: transport,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}}
}

func (p *httpProvider) generate(ctx context.Context, start plugin.AIProviderStart, emit plugin.AIProviderEmit) (plugin.AIProviderCompletion, error) {
	request, err := newUpstreamRequest(ctx, start)
	if err != nil {
		return plugin.AIProviderCompletion{}, err
	}
	response, err := p.client.Do(request)
	if err != nil {
		return plugin.AIProviderCompletion{}, failure("generation_failed")
	}
	defer response.Body.Close()
	mediaType, _, mediaErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if response.StatusCode != http.StatusOK || mediaErr != nil || mediaType != "text/event-stream" {
		return plugin.AIProviderCompletion{}, failure("generation_failed")
	}
	return readCompletion(ctx, response.Body, emit)
}

func newUpstreamRequest(ctx context.Context, start plugin.AIProviderStart) (*http.Request, error) {
	endpoint, err := completionURL(start.Config.BaseURL)
	if err != nil {
		return nil, err
	}
	body := upstreamRequest{
		Model: start.Config.Model, Messages: start.Request.Messages,
		Temperature: start.Request.Temperature, MaxTokens: start.Request.MaxTokens,
		Tools: start.Request.Tools, N: 1, Stream: true,
	}
	body.StreamOptions.IncludeUsage = true
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, failure("invalid_request")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return nil, failure("invalid_request")
	}
	// A POST may have an uncertain outcome. Never make its body replayable.
	request.GetBody = nil
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	request.Header.Set("User-Agent", "")
	for name, value := range start.Config.Headers {
		request.Header.Set(name, value)
	}
	if start.Config.APIKey != "" {
		request.Header.Set("Authorization", "Bearer "+start.Config.APIKey)
	}
	return request, nil
}

func completionURL(base string) (string, error) {
	if base == "" || len(base) > 4096 {
		return "", failure("invalid_request")
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.Opaque != "" || parsed.Fragment != "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", failure("invalid_request")
	}
	escaped := strings.TrimRight(parsed.EscapedPath(), "/") + "/chat/completions"
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/chat/completions"
	parsed.RawPath = escaped
	return parsed.String(), nil
}

func failure(code string) error { return &plugin.AIProviderFailure{Code: code} }
