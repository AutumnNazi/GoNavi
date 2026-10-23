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

func submitExporterArchive(t *testing.T, f *httpFixture, format, version string, payload []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range map[string]string{"pluginId": "acme.exporter", "version": version} {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatal(err)
		}
	}
	part, err := writer.CreateFormFile("package", "exporter"+format)
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

func TestArtifactExportersEveryVersionRequiresReviewAndPreservesBytes(t *testing.T) {
	for _, format := range []string{".zip", ".tgz"} {
		t.Run(format, func(t *testing.T) {
			f := newHTTPFixture(t)
			previous := ""
			for _, version := range []string{"1.2.3", "1.2.4"} {
				manifest := artifactExporterManifest(t, func(fields, exporter map[string]any) {
					fields["version"] = version
					fields["name"] = "Official exporter display claim"
					fields["author"] = "GoNavi Official"
				})
				_, payload := artifactExporterArchive(t, format, manifest)
				response := submitExporterArchive(t, f, format, version, payload)
				assertStatus(t, response, 201)
				submission := decodeResponse[Submission](t, response)
				if submission.State != "pending_review" || submission.SHA256 != artifactTestDigest(payload) {
					t.Fatalf("submission=%+v", submission)
				}
				before := f.request("GET", "/plugins/acme.exporter", "", nil)
				if previous == "" {
					assertStatus(t, before, 404)
				} else {
					assertStatus(t, before, 200)
					if visible := decodeResponse[MarketPlugin](t, before); visible.Version != previous {
						t.Fatal("unreviewed exporter replaced the public version")
					}
				}
				assertStatus(t, f.request("GET", "/artifacts/"+submission.SHA256, "", nil), 404)
				previewResponse := f.request("GET", "/admin/submissions/"+submission.ID, "admin", nil)
				assertStatus(t, previewResponse, 200)
				if preview := decodeResponse[ReviewDetail](t, previewResponse); !bytes.Equal(preview.Manifest, []byte(manifest)) {
					t.Fatal("review manifest changed")
				}
				assertStatus(t, f.request("POST", "/admin/submissions/"+submission.ID+"/approve", "publisher", strings.NewReader("{}")), 403)
				assertStatus(t, f.request("POST", "/admin/submissions/"+submission.ID+"/approve", "admin", strings.NewReader("{}")), 200)
				publishedResponse := f.request("GET", "/plugins/acme.exporter", "", nil)
				assertStatus(t, publishedResponse, 200)
				published := decodeResponse[MarketPlugin](t, publishedResponse)
				if published.Official || published.PublisherID != "acme" || published.Version != version {
					t.Fatal("manifest display claims changed publisher authority")
				}
				if !bytes.Equal(published.Manifest, []byte(manifest)) {
					t.Fatal("published exporter manifest changed")
				}
				var saved artifactManifest
				if err := json.Unmarshal(published.Manifest, &saved); err != nil {
					t.Fatal(err)
				}
				if len(saved.Contributes.Exporters) != 1 || saved.Contributes.Exporters[0].Extension != "ndjson" || saved.Contributes.Exporters[0].ContentType != "application/x-ndjson" {
					t.Fatal("published exporter metadata changed")
				}
				download := f.request("GET", "/artifacts/"+submission.SHA256, "", nil)
				assertStatus(t, download, 200)
				if !bytes.Equal(download.Body.Bytes(), payload) {
					t.Fatal("published exporter archive bytes changed")
				}
				previous = version
			}
		})
	}
}

func TestArtifactExportersRejectBeforeImmutableStorage(t *testing.T) {
	cases := []struct {
		name   string
		change func(map[string]any, map[string]any)
	}{
		{name: "missing extension", change: func(f, e map[string]any) { delete(e, "extension") }},
		{name: "null content type", change: func(f, e map[string]any) { e["contentType"] = nil }},
		{name: "path extension", change: func(f, e map[string]any) { e["extension"] = "../csv" }},
		{name: "parameterized content type", change: func(f, e map[string]any) { e["contentType"] = "text/plain; charset=utf-8" }},
		{name: "missing permission", change: func(f, e map[string]any) { f["permissions"] = []string{"ai.tools"} }},
		{name: "missing backend", change: func(f, e map[string]any) { delete(f, "backend") }},
		{name: "undeclared command", change: func(f, e map[string]any) { e["command"] = "Missing" }},
		{name: "unknown destination", change: func(f, e map[string]any) { e["filePath"] = "DO_NOT_DISCLOSE_DESTINATION" }},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				f := newHTTPFixture(t)
				_, payload := artifactExporterArchive(t, format, artifactExporterManifest(t, test.change))
				response := submitExporterArchive(t, f, format, "1.2.3", payload)
				assertStatus(t, response, 400)
				if failure := decodeResponse[APIError](t, response); failure.Code != "artifact_invalid" {
					t.Fatalf("failure=%+v", failure)
				}
				submissionsResponse := f.request("GET", "/submissions", "publisher", nil)
				assertStatus(t, submissionsResponse, 200)
				submissions := decodeResponse[[]Submission](t, submissionsResponse)
				if len(submissions) != 1 || submissions[0].State != "rejected" || submissions[0].SHA256 != "" {
					t.Fatal("invalid exporter declaration not rejected")
				}
				assertStatus(t, f.request("GET", "/plugins/acme.exporter", "", nil), 404)
				stored, err := f.server.artifacts.Open(context.Background(), artifactTestDigest(payload))
				if err == nil {
					if closeErr := stored.Close(); closeErr != nil {
						t.Error(closeErr)
					}
					t.Fatal("invalid exporter reached immutable storage")
				}
				if !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("unexpected storage error: %v", err)
				}
				auditResponse := f.request("GET", "/admin/audit", "admin", nil)
				assertStatus(t, auditResponse, 200)
				audit := decodeResponse[[]Audit](t, auditResponse)
				if len(audit) != 4 || audit[3].Action != "submission.rejected" {
					t.Fatal("missing rejection audit")
				}
				for _, result := range []*httptest.ResponseRecorder{response, submissionsResponse, auditResponse} {
					if strings.Contains(result.Body.String(), "DO_NOT_DISCLOSE_DESTINATION") {
						t.Fatal("unknown exporter value leaked into diagnostics")
					}
				}
			})
		}
	}
}
