package market

import (
	"context"
	"strings"
	"testing"
)

func TestNestedManifestFieldDoesNotEchoName(t *testing.T) {
	name := strings.Repeat("文", 80)
	for _, modify := range []func(map[string]any){
		func(fields map[string]any) {
			body := map[string]any{"type": "text", "text": "ok"}
			body[name] = true
			fields["contributes"] = map[string]any{"panels": []any{map[string]any{"id": "main", "title": "Panel", "body": body}}}
		},
		func(fields map[string]any) {
			model := map[string]any{"id": "m", "name": "M", "contextWindow": 1024, "maxOutputTokens": 1}
			model[name] = true
			fields["contributes"] = map[string]any{"aiProviders": []any{map[string]any{"id": "chat", "name": "Chat", "command": "ask", "models": []any{model}, "supportsTools": false, "supportsImages": false}}}
		},
	} {
		manifest := artifactTestChange(t, modify)
		filename := artifactTestWrite(t, ".zip", artifactTestZIP(t, artifactTestEntries(manifest)))
		_, err := ValidatePackage(context.Background(), filename)
		if err == nil || strings.Contains(err.Error(), strings.Repeat("文", 40)) || strings.Contains(err.Error(), filename) {
			t.Fatal(err)
		}
	}
}
