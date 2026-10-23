package provider

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/plugin"
)

func pluginImage(payload []byte) string {
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(payload)
}

func TestPluginRequestAcceptsDeclaredImages(t *testing.T) {
	p := pluginStreamFixture()
	p.declaration.SupportsImages = true
	req := pluginStreamRequest()
	req.Messages[0].Images = []string{pluginImage([]byte("hello"))}
	copied, _, err := p.prepareRequest(req)
	if err != nil || len(copied.Messages[0].Images) != 1 || copied.Messages[0].Images[0] != req.Messages[0].Images[0] {
		t.Fatalf("declared image rejected or dropped: %v %+v", err, copied.Messages)
	}
	req.Messages[0].Images = []string{
		pluginImage([]byte("a")), pluginImage([]byte("b")),
		pluginImage([]byte("c")), pluginImage([]byte("d")),
	}
	if _, _, err = p.prepareRequest(req); err != nil {
		t.Fatalf("four images rejected: %v", err)
	}
	large := pluginImage(make([]byte, 768<<10))
	req.Messages[0].Images = []string{large}
	if _, _, err = p.prepareRequest(req); err != nil {
		t.Fatalf("image request above the text budget rejected: %v", err)
	}
	req.Messages[0].Images = []string{large, pluginImage(make([]byte, 768<<10))}
	if _, _, err = p.prepareRequest(req); err != nil {
		t.Fatalf("bounded multi-image request rejected: %v", err)
	}
}

func TestPluginRequestRejectsUndeclaredOrUnboundedImages(t *testing.T) {
	valid := pluginImage([]byte("hello"))
	cases := map[string]struct {
		images  []string
		role    string
		support bool
	}{
		"provider without capability": {images: []string{valid}},
		"assistant image":             {images: []string{valid}, role: "assistant", support: true},
		"five images":                 {images: []string{valid, valid, valid, valid, valid}, support: true},
		"remote url":                  {images: []string{"https://example.invalid/a.png"}, support: true},
		"unsupported media type":      {images: []string{"data:image/svg+xml;base64,PHN2Zy8+"}, support: true},
		"empty payload":               {images: []string{"data:image/png;base64,"}, support: true},
		"invalid base64":              {images: []string{"data:image/png;base64,!!!"}, support: true},
		"missing base64 marker":       {images: []string{"data:image/png,hello"}, support: true},
		"oversized decoded image":     {images: []string{pluginImage(make([]byte, pluginMaxImageDecodedBytes+1))}, support: true},
	}
	for name, test := range cases {
		t.Run(name, func(t *testing.T) {
			p := pluginStreamFixture()
			p.declaration.SupportsImages = test.support
			req := pluginStreamRequest()
			if test.role != "" {
				req.Messages[0].Role = test.role
			}
			req.Messages[0].Images = test.images
			if _, _, err := p.prepareRequest(req); err == nil {
				t.Fatal("unbounded or undeclared image accepted")
			}
		})
	}
}

func TestPluginRequestRejectsImageTotalBudget(t *testing.T) {
	p := pluginStreamFixture()
	p.declaration.SupportsImages = true
	req := pluginStreamRequest()
	image := pluginImage(make([]byte, pluginMaxImageDecodedBytes))
	req.Messages = []ai.Message{
		{Role: "user", Content: "a", Images: []string{image, image, image, image}},
		{Role: "user", Content: "b", Images: []string{image}},
	}
	if _, _, err := p.prepareRequest(req); err == nil {
		t.Fatal("request image total budget exceeded")
	}
	if pluginRequestBytes(true) != pluginImageRequestBytes || pluginRequestBytes(false) != pluginTextRequestBytes {
		t.Fatal("request byte budgets do not follow the declaration")
	}
}

func TestPluginCatalogReportsDeclaredImages(t *testing.T) {
	declaration := plugin.AIProvider{ID: "vision", Name: "Vision", Command: "generate", SupportsImages: true, Models: []plugin.AIModel{{ID: "model-1", Name: "Model", ContextWindow: 4096, MaxOutputTokens: 128}}}
	status := plugin.Status{Manifest: plugin.Manifest{ID: "test.models", Version: "1.0.0", Permissions: []string{"ai.providers"}, Backend: &plugin.Backend{}, Contributes: plugin.Contributions{AIProviders: []plugin.AIProvider{declaration}}}, Digest: strings.Repeat("a", 64), State: plugin.StateDisabled}
	f := NewPluginFactory(func(context.Context) (PluginProviderSnapshot, error) {
		return PluginProviderSnapshot{Statuses: []plugin.Status{status}}, nil
	}, nil)
	views, err := f.Catalog(context.Background())
	if err != nil || len(views) != 1 || !views[0].SupportsImages {
		t.Fatalf("image provider not reported: %+v %v", views, err)
	}
}
