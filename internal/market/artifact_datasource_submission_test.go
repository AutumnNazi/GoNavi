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

func submitDataSourceArchive(t *testing.T, f *httpFixture, format string, payload []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range map[string]string{"pluginId": "acme.datasource", "version": "1.2.3"} {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatal(err)
		}
	}
	part, err := writer.CreateFormFile("package", "datasource"+format)
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

func TestArtifactDataSourceSubmissionRequiresManualReview(t *testing.T) {
	for _, format := range []string{".zip", ".tgz"} {
		t.Run(format, func(t *testing.T) {
			f := newHTTPFixture(t)
			manifest := artifactDataSourceManifest(t, nil)
			payload := artifactTestArchive(t, format, artifactTestEntries(manifest))
			response := submitDataSourceArchive(t, f, format, payload)
			assertStatus(t, response, 201)
			submission := decodeResponse[Submission](t, response)
			if submission.State != "pending_review" || submission.SHA256 != artifactTestDigest(payload) {
				t.Fatalf("submission=%+v", submission)
			}
			assertStatus(t, f.request("GET", "/plugins/acme.datasource", "", nil), 404)
			assertStatus(t, f.request("GET", "/artifacts/"+submission.SHA256, "", nil), 404)
			preview := decodeResponse[ReviewDetail](t, f.request("GET", "/admin/submissions/"+submission.ID, "admin", nil))
			if !bytes.Equal(preview.Manifest, []byte(manifest)) {
				t.Fatal("review manifest differs from inspected datasource manifest")
			}
			assertStatus(t, f.request("POST", "/admin/submissions/"+submission.ID+"/approve", "admin", strings.NewReader("{}")), 200)
			published := decodeResponse[MarketPlugin](t, f.request("GET", "/plugins/acme.datasource", "", nil))
			var saved artifactManifest
			if err := json.Unmarshal(published.Manifest, &saved); err != nil {
				t.Fatal(err)
			}
			sources := saved.Contributes.DataSources
			if len(sources) != 1 || !sources[0].ReadOnly || sources[0].Dialect != "postgres" || sources[0].Command != "Driver" {
				t.Fatalf("published source=%+v", sources)
			}
			download := f.request("GET", "/artifacts/"+submission.SHA256, "", nil)
			assertStatus(t, download, 200)
			if !bytes.Equal(download.Body.Bytes(), payload) {
				t.Fatal("published archive changed after datasource validation")
			}
		})
	}
}

func TestArtifactDataSourceSubmissionRejectsInvalidCapability(t *testing.T) {
	cases := []struct {
		name   string
		change func(map[string]any, map[string]any)
	}{
		{name: "missing readOnly", change: func(_ map[string]any, source map[string]any) { delete(source, "readOnly") }},
		{name: "write capability", change: func(_ map[string]any, source map[string]any) { source["readOnly"] = false }},
		{name: "unsupported dialect", change: func(_ map[string]any, source map[string]any) { source["dialect"] = "oracle" }},
		{name: "missing permission", change: func(fields map[string]any, _ map[string]any) { fields["permissions"] = []string{} }},
		{name: "undeclared command", change: func(_ map[string]any, source map[string]any) { source["command"] = "missing" }},
		{name: "namespace injection", change: func(_ map[string]any, source map[string]any) { source["id"] = "database:mysql" }},
		{name: "port overflow", change: func(_ map[string]any, source map[string]any) { source["defaultPort"] = 65536 }},
		{name: "missing backend", change: func(fields map[string]any, _ map[string]any) { delete(fields, "backend") }},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				f := newHTTPFixture(t)
				manifest := artifactDataSourceManifest(t, test.change)
				payload := artifactTestArchive(t, format, artifactTestEntries(manifest))
				response := submitDataSourceArchive(t, f, format, payload)
				assertStatus(t, response, 400)
				if failure := decodeResponse[APIError](t, response); failure.Code != "artifact_invalid" {
					t.Fatalf("failure=%+v", failure)
				}
				submissions := decodeResponse[[]Submission](t, f.request("GET", "/submissions", "publisher", nil))
				if len(submissions) != 1 || submissions[0].State != "rejected" || submissions[0].SHA256 != "" {
					t.Fatalf("invalid source was not rejected: %+v", submissions)
				}
				assertStatus(t, f.request("GET", "/plugins/acme.datasource", "", nil), 404)
				stored, err := f.server.artifacts.Open(context.Background(), artifactTestDigest(payload))
				if err == nil {
					if closeErr := stored.Close(); closeErr != nil {
						t.Error(closeErr)
					}
					t.Fatal("invalid datasource archive reached immutable storage")
				}
				if !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("unexpected store error: %v", err)
				}
				audit := decodeResponse[[]Audit](t, f.request("GET", "/admin/audit", "admin", nil))
				if len(audit) != 4 || audit[3].Action != "submission.rejected" {
					t.Fatalf("missing validation rejection audit: %+v", audit)
				}
			})
		}
	}
}
