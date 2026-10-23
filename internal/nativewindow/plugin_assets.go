package nativewindow

import (
	"bytes"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"

	htmlparser "golang.org/x/net/html"
)

func validPluginAssetName(name string) bool {
	if !fs.ValidPath(name) || name == "." || strings.ContainsAny(name, "\\:%?") || len(name) > 1024 {
		return false
	}
	for _, character := range name {
		if character < 32 || character == 127 {
			return false
		}
	}
	return true
}

func (c *PluginController) serveAsset(w http.ResponseWriter, r *http.Request, entry *pluginWindowEntry) {
	if !pluginMethod(w, r, http.MethodGet) {
		return
	}
	name := strings.TrimPrefix(r.URL.Path, pluginAssetPrefix)
	if !validPluginAssetName(name) {
		pluginHTTPError(w, http.StatusBadRequest, "invalid_asset_path")
		return
	}
	contentType := pluginAssetType(name)
	if contentType == "" {
		pluginHTTPError(w, http.StatusForbidden, "asset_type_denied")
		return
	}
	c.mu.Lock()
	if entry.closing || entry.assetCalls >= 4 {
		c.mu.Unlock()
		pluginHTTPError(w, http.StatusTooManyRequests, "asset_limit")
		return
	}
	entry.assetCalls++
	c.mu.Unlock()
	defer func() { c.mu.Lock(); entry.assetCalls--; c.mu.Unlock() }()
	// This is deliberately the only package-file resolver. Never use a plugin
	// directory with FileServer, and never proxy arbitrary host filesystem paths.
	assetPath, err := c.manager.AssetPath(entry.info.PluginID, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(assetPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	limit := int64(pluginMaxAssetBytes)
	html := strings.HasPrefix(contentType, "text/html")
	if html {
		limit = pluginMaxHTMLBytes
	}
	if info.Size() > limit {
		pluginHTTPError(w, http.StatusRequestEntityTooLarge, "asset_too_large")
		return
	}
	payload, err := readPluginBytes(file, limit)
	if err != nil {
		pluginHTTPError(w, http.StatusRequestEntityTooLarge, "asset_too_large")
		return
	}
	if entry.life.Err() != nil {
		pluginHTTPError(w, http.StatusGone, "window_revoked")
		return
	}
	if _, err := c.entryStatus(entry); err != nil {
		pluginHTTPError(w, http.StatusGone, "generation_revoked")
		return
	}
	if html {
		payload = injectPluginRuntime(payload)
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Security-Policy", pluginContentSecurityPolicy())
	writePluginBody(w, payload)
}

func readPluginBytes(reader io.Reader, limit int64) ([]byte, error) {
	payload, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(payload)) > limit {
		return nil, errors.New("plugin payload exceeds limit")
	}
	return payload, nil
}

func injectPluginRuntime(html []byte) []byte {
	script := []byte(`<script src="` + pluginBridgePrefix + `runtime.js"></script>`)
	offset := pluginRuntimeOffset(html)
	result := make([]byte, 0, len(html)+len(script))
	result = append(result, html[:offset]...)
	result = append(result, script...)
	return append(result, html[offset:]...)
}

func pluginRuntimeOffset(document []byte) int {
	tokenizer := htmlparser.NewTokenizer(bytes.NewReader(document))
	offset := 0
	for {
		token := tokenizer.Next()
		start := offset
		offset += len(tokenizer.Raw())
		if token == htmlparser.ErrorToken {
			return 0
		}
		if token != htmlparser.StartTagToken && token != htmlparser.SelfClosingTagToken {
			continue
		}
		name, _ := tokenizer.TagName()
		if bytes.EqualFold(name, []byte("head")) {
			return offset
		}
		if !bytes.EqualFold(name, []byte("html")) {
			return start
		}
	}
}

func pluginAssetType(name string) string {
	extension := strings.ToLower(path.Ext(name))
	switch extension {
	case ".html":
		return "text/html; charset=utf-8"
	case ".js", ".mjs":
		return "application/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".json":
		return "application/json"
	case ".wasm":
		return "application/wasm"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".ico":
		return "image/x-icon"
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	case ".ttf":
		return "font/ttf"
	case ".otf":
		return "font/otf"
	case ".mp3":
		return "audio/mpeg"
	case ".mp4":
		return "video/mp4"
	case ".ogg":
		return "audio/ogg"
	case ".wav":
		return "audio/wav"
	default:
		return ""
	}
}

func pluginContentSecurityPolicy() string {
	return "default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
		"connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; " +
		"worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'"
}
