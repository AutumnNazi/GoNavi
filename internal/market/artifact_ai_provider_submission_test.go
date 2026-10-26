package market

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func submitAIProviderArchive(t *testing.T, f *httpFixture, format, version string, payload []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range map[string]string{"pluginId": "acme.aiprovider", "version": version} {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatal(err)
		}
	}
	part, err := writer.CreateFormFile("package", "provider"+format)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "http://localhost:8090/api/v1/submissions", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+f.tokens["publisher"])
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, request)
	return response
}

func TestArtifactAIProvidersSelfPublishAndPreserveBytes(t *testing.T) {
	for _, format := range []string{".zip", ".tgz"} {
		t.Run(format, func(t *testing.T) {
			f := newHTTPFixture(t)
			for _, version := range []string{"1.2.3", "1.2.4"} {
				manifest := artifactAIProviderManifest(t, func(fields, provider, model map[string]any) {
					fields["version"] = version
					fields["name"] = "Official AI display claim"
					fields["author"] = "GoNavi Official"
				})
				_, payload := artifactAIProviderArchive(t, format, manifest)
				response := submitAIProviderArchive(t, f, format, version, payload)
				assertStatus(t, response, 201)
				submission := decodeResponse[Submission](t, response)
				if submission.State != "published" || submission.SHA256 != artifactTestDigest(payload) {
					t.Fatalf("submission=%+v", submission)
				}
				publishedResponse := f.request("GET", "/plugins/acme.aiprovider", "", nil)
				assertStatus(t, publishedResponse, 200)
				published := decodeResponse[MarketPlugin](t, publishedResponse)
				if published.Official || published.PublisherID != "acme" || published.Version != version {
					t.Fatalf("manifest display labels changed publication authority: %+v", published)
				}
				var saved artifactManifest
				if err := json.Unmarshal(published.Manifest, &saved); err != nil {
					t.Fatal(err)
				}
				providers := saved.Contributes.AIProviders
				if len(providers) != 1 || providers[0].SupportsTools == nil || !*providers[0].SupportsTools || providers[0].SupportsImages == nil || *providers[0].SupportsImages || len(providers[0].Models) != 1 {
					t.Fatal("published static model capabilities changed")
				}
				if !bytes.Equal(published.Manifest, []byte(manifest)) {
					t.Fatal("published provider manifest changed")
				}
				previewResponse := f.request("GET", "/admin/submissions/"+submission.ID, "admin", nil)
				assertStatus(t, previewResponse, 200)
				preview := decodeResponse[ReviewDetail](t, previewResponse)
				if !bytes.Equal(preview.Manifest, []byte(manifest)) {
					t.Fatal("AI provider supervision manifest changed")
				}
				download := f.request("GET", "/artifacts/"+submission.SHA256, "", nil)
				assertStatus(t, download, 200)
				if !bytes.Equal(download.Body.Bytes(), payload) {
					t.Fatal("published provider artifact bytes changed")
				}
			}
		})
	}
}

func TestArtifactAIProvidersRejectBeforeImmutableStorage(t *testing.T) {
	cases := []struct {
		name   string
		change func(map[string]any, map[string]any, map[string]any)
	}{
		{name: "missing explicit tools", change: func(f, p, m map[string]any) { delete(p, "supportsTools") }},
		{name: "missing explicit images", change: func(f, p, m map[string]any) { delete(p, "supportsImages") }},
		{name: "missing permission", change: func(f, p, m map[string]any) { f["permissions"] = []string{"ai.tools"} }},
		{name: "missing backend", change: func(f, p, m map[string]any) { delete(f, "backend") }},
		{name: "undeclared command", change: func(f, p, m map[string]any) { p["command"] = "Missing" }},
		{name: "invalid model bounds", change: func(f, p, m map[string]any) { m["maxOutputTokens"] = 65537 }},
		{name: "invalid null models", change: func(f, p, m map[string]any) { p["models"] = nil }},
		{name: "unknown credential field", change: func(f, p, m map[string]any) { p["apiKey"] = "DO_NOT_DISCLOSE_PROVIDER_KEY" }},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				f := newHTTPFixture(t)
				_, payload := artifactAIProviderArchive(t, format, artifactAIProviderManifest(t, test.change))
				response := submitAIProviderArchive(t, f, format, "1.2.3", payload)
				assertStatus(t, response, 400)
				if failure := decodeResponse[APIError](t, response); failure.Code != "artifact_invalid" {
					t.Fatalf("failure=%+v", failure)
				}
				submissionsResponse := f.request("GET", "/submissions", "publisher", nil)
				submissions := decodeResponse[[]Submission](t, submissionsResponse)
				if len(submissions) != 1 || submissions[0].State != "rejected" || submissions[0].SHA256 != "" {
					t.Fatalf("invalid provider declaration was not rejected: %+v", submissions)
				}
				assertStatus(t, f.request("GET", "/plugins/acme.aiprovider", "", nil), 404)
				stored, err := f.server.artifacts.Open(context.Background(), artifactTestDigest(payload))
				if err == nil {
					if closeErr := stored.Close(); closeErr != nil {
						t.Error(closeErr)
					}
					t.Fatal("invalid provider artifact reached immutable storage")
				}
				if !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("unexpected artifact store error: %v", err)
				}
				auditResponse := f.request("GET", "/admin/audit", "admin", nil)
				audit := decodeResponse[[]Audit](t, auditResponse)
				if len(audit) != 4 || audit[3].Action != "submission.rejected" {
					t.Fatalf("missing validation rejection audit: %+v", audit)
				}
				for _, result := range []*httptest.ResponseRecorder{response, submissionsResponse, auditResponse} {
					if strings.Contains(result.Body.String(), "DO_NOT_DISCLOSE_PROVIDER_KEY") {
						t.Fatal("unknown credential value leaked into diagnostics")
					}
				}
			})
		}
	}
}
