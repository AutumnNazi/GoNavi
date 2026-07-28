package nacos

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultListenTimeoutMs = 30000
	maxListenTimeoutMs     = 60000
	minListenTimeoutMs     = 5000
)

// ContentMD5 returns the hex MD5 used by Nacos config listening.
func ContentMD5(content string) string {
	sum := md5.Sum([]byte(content))
	return hex.EncodeToString(sum[:])
}

// ListenOnce performs one Nacos config long-poll request.
func (c *ClientImpl) ListenOnce(ctx context.Context, targets []ConfigListenTarget, timeoutMs int) ([]ConfigListenTarget, error) {
	cleaned := make([]ConfigListenTarget, 0, len(targets))
	for _, target := range targets {
		dataID := strings.TrimSpace(target.DataID)
		group := strings.TrimSpace(target.Group)
		if dataID == "" {
			continue
		}
		if group == "" {
			group = "DEFAULT_GROUP"
		}
		cleaned = append(cleaned, ConfigListenTarget{
			NamespaceID: normalizeNamespaceID(target.NamespaceID),
			DataID:      dataID,
			Group:       group,
			ContentMD5:  strings.TrimSpace(target.ContentMD5),
		})
	}
	if len(cleaned) == 0 {
		return nil, localizedNacosBackendError("nacos.backend.error.listen_target_required", nil)
	}

	timeoutMs = normalizeListenTimeoutMs(timeoutMs)
	if err := c.ensureAuth(ctx); err != nil {
		return nil, err
	}

	// Build Listening-Configs packet:
	// dataId\x02group\x02md5\x02tenant\x01  (tenant optional for public)
	var b strings.Builder
	for _, target := range cleaned {
		b.WriteString(target.DataID)
		b.WriteByte(2)
		b.WriteString(target.Group)
		b.WriteByte(2)
		b.WriteString(target.ContentMD5)
		if target.NamespaceID != "" {
			b.WriteByte(2)
			b.WriteString(target.NamespaceID)
		}
		b.WriteByte(1)
	}

	form := url.Values{}
	form.Set("Listening-Configs", b.String())

	// Long poll needs a client timeout larger than Long-Pulling-Timeout.
	listenCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs+10000)*time.Millisecond)
	defer cancel()

	body, status, err := c.doListenRequest(listenCtx, form, timeoutMs)
	if err != nil {
		// Context cancel/deadline is expected when stopping listeners.
		if listenCtx.Err() != nil && (ctx.Err() != nil || listenCtx.Err() == context.DeadlineExceeded) {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			// Server-side timeout with empty body is normal; treat as no change.
			return []ConfigListenTarget{}, nil
		}
		return nil, err
	}
	if status == http.StatusForbidden || status == http.StatusUnauthorized {
		c.mu.Lock()
		c.accessToken = ""
		c.tokenExpiry = time.Time{}
		c.mu.Unlock()
		if err := c.ensureAuth(ctx); err != nil {
			return nil, err
		}
		body, status, err = c.doListenRequest(listenCtx, form, timeoutMs)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return []ConfigListenTarget{}, nil
		}
	}
	if status < 200 || status >= 300 {
		return nil, localizedNacosBackendError("nacos.backend.error.http_status", map[string]any{
			"status": status,
			"body":   truncateForError(string(body)),
		})
	}

	changed := parseListenResponse(string(body))
	if len(changed) == 0 {
		return []ConfigListenTarget{}, nil
	}
	return changed, nil
}

func (c *ClientImpl) doListenRequest(ctx context.Context, form url.Values, timeoutMs int) ([]byte, int, error) {
	c.mu.Lock()
	baseClient := c.httpClient
	baseURL := c.baseURL
	token := c.accessToken
	c.mu.Unlock()

	if baseClient == nil || baseURL == nil {
		return nil, 0, localizedNacosBackendError("nacos.backend.error.not_connected", nil)
	}

	// Avoid inherited short Timeout from the shared client.
	listenClient := &http.Client{
		Transport: baseClient.Transport,
		// Zero Timeout: rely on request context deadline.
		Timeout: 0,
	}

	rel := &url.URL{Path: joinAPIPath(baseURL.Path, "/v1/cs/configs/listener")}
	query := url.Values{}
	if strings.TrimSpace(token) != "" {
		query.Set("accessToken", token)
	}
	rel.RawQuery = query.Encode()
	fullURL := baseURL.ResolveReference(rel).String()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fullURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, 0, localizedNacosBackendError("nacos.backend.error.build_request", map[string]any{
			"detail": err.Error(),
		})
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Long-Pulling-Timeout", strconv.Itoa(timeoutMs))
	req.Header.Set("Accept", "*/*")

	resp, err := listenClient.Do(req)
	if err != nil {
		return nil, 0, localizedNacosBackendError("nacos.backend.error.request_failed", map[string]any{
			"detail": err.Error(),
		})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, resp.StatusCode, localizedNacosBackendError("nacos.backend.error.read_body", map[string]any{
			"detail": err.Error(),
		})
	}
	return body, resp.StatusCode, nil
}

func parseListenResponse(raw string) []ConfigListenTarget {
	text := strings.TrimSpace(raw)
	if text == "" {
		return nil
	}
	// Response packets are separated by \x01, fields by \x02.
	// Format: dataId\x02group\x02tenant\x01  (tenant optional)
	parts := strings.Split(text, string(byte(1)))
	result := make([]ConfigListenTarget, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		fields := strings.Split(part, string(byte(2)))
		if len(fields) < 2 {
			continue
		}
		dataID := strings.TrimSpace(fields[0])
		group := strings.TrimSpace(fields[1])
		tenant := ""
		if len(fields) >= 3 {
			tenant = strings.TrimSpace(fields[2])
		}
		if dataID == "" {
			continue
		}
		if group == "" {
			group = "DEFAULT_GROUP"
		}
		result = append(result, ConfigListenTarget{
			NamespaceID: normalizeNamespaceID(tenant),
			DataID:      dataID,
			Group:       group,
		})
	}
	return result
}

func normalizeListenTimeoutMs(timeoutMs int) int {
	if timeoutMs <= 0 {
		return defaultListenTimeoutMs
	}
	if timeoutMs < minListenTimeoutMs {
		return minListenTimeoutMs
	}
	if timeoutMs > maxListenTimeoutMs {
		return maxListenTimeoutMs
	}
	return timeoutMs
}
