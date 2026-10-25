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

func submitSkillArchive(t *testing.T, f *httpFixture, format string, payload []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range map[string]string{"pluginId": "acme.skills", "version": "1.2.3"} {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatal(err)
		}
	}
	part, err := writer.CreateFormFile("package", "skills"+format)
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

func TestArtifactSkillsSubmissionSelfPublishes(t *testing.T) {
	for _, format := range []string{".zip", ".tgz"} {
		t.Run(format, func(t *testing.T) {
			f := newHTTPFixture(t)
			manifest := artifactSkillManifest(t, nil)
			content := []byte("---\r\nname: DO_NOT_OVERRIDE_METADATA\r\nautoInject: true\r\napproved: true\r\npermissions: [host.exec]\r\n---\r\nUNTRUSTED_SKILL_BODY\r\n")
			_, payload := artifactSkillArchive(t, format, manifest, artifactSkillTestEntry, content)
			response := submitSkillArchive(t, f, format, payload)
			assertStatus(t, response, 201)
			submission := decodeResponse[Submission](t, response)
			if submission.State != "published" || submission.SHA256 != artifactTestDigest(payload) {
				t.Fatalf("submission=%+v", submission)
			}
			previewResponse := f.request("GET", "/admin/submissions/"+submission.ID, "admin", nil)
			assertStatus(t, previewResponse, 200)
			preview := decodeResponse[ReviewDetail](t, previewResponse)
			if !bytes.Equal(preview.Manifest, []byte(manifest)) {
				t.Fatal("review metadata changed after skill inspection")
			}
			if strings.Contains(previewResponse.Body.String(), "UNTRUSTED_SKILL_BODY") {
				t.Fatal("review discovery included the skill body")
			}
			publishedResponse := f.request("GET", "/plugins/acme.skills", "", nil)
			assertStatus(t, publishedResponse, 200)
			published := decodeResponse[MarketPlugin](t, publishedResponse)
			var saved artifactManifest
			if err := json.Unmarshal(published.Manifest, &saved); err != nil {
				t.Fatal(err)
			}
			if saved.Backend != nil || len(saved.Permissions) != 1 || saved.Permissions[0] != "ai.skills" || len(saved.Contributes.Skills) != 1 {
				t.Fatal("skill text altered declaration or execution permissions")
			}
			if !bytes.Equal(published.Manifest, []byte(manifest)) || strings.Contains(publishedResponse.Body.String(), "UNTRUSTED_SKILL_BODY") {
				t.Fatal("published discovery replaced metadata with skill content")
			}
			download := f.request("GET", "/artifacts/"+submission.SHA256, "", nil)
			assertStatus(t, download, 200)
			if !bytes.Equal(download.Body.Bytes(), payload) {
				t.Fatal("published skill archive bytes changed")
			}
		})
	}
}

func TestArtifactSkillsSubmissionRejectsBeforeStorage(t *testing.T) {
	cases := []struct {
		name    string
		body    []byte
		missing bool
		change  func(map[string]any, map[string]any)
	}{
		{name: "missing entry", missing: true},
		{name: "empty document"},
		{name: "oversized document", body: bytes.Repeat([]byte("x"), (64<<10)+1)},
		{name: "invalid utf8", body: []byte{0xff}},
		{name: "nul and diagnostic redaction", body: []byte("SECRET_SKILL_CONTENT" + string(rune(0)))},
		{name: "missing permission", body: []byte("Text"), change: func(fields map[string]any, _ map[string]any) { fields["permissions"] = []string{} }},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				f := newHTTPFixture(t)
				entries := []artifactTestEntry{{name: artifactManifestName, body: []byte(artifactSkillManifest(t, test.change))}}
				if !test.missing {
					entries = append(entries, artifactTestEntry{name: artifactSkillTestEntry, body: test.body})
				}
				payload := artifactTestArchive(t, format, entries)
				response := submitSkillArchive(t, f, format, payload)
				assertStatus(t, response, 400)
				if failure := decodeResponse[APIError](t, response); failure.Code != "artifact_invalid" {
					t.Fatalf("failure=%+v", failure)
				}
				submissionsResponse := f.request("GET", "/submissions", "publisher", nil)
				submissions := decodeResponse[[]Submission](t, submissionsResponse)
				if len(submissions) != 1 || submissions[0].State != "rejected" || submissions[0].SHA256 != "" {
					t.Fatalf("invalid skill was not rejected: %+v", submissions)
				}
				assertStatus(t, f.request("GET", "/plugins/acme.skills", "", nil), 404)
				stored, err := f.server.artifacts.Open(context.Background(), artifactTestDigest(payload))
				if err == nil {
					if closeErr := stored.Close(); closeErr != nil {
						t.Error(closeErr)
					}
					t.Fatal("invalid skill reached immutable artifact storage")
				}
				if !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("unexpected store error: %v", err)
				}
				auditResponse := f.request("GET", "/admin/audit", "admin", nil)
				audit := decodeResponse[[]Audit](t, auditResponse)
				if len(audit) != 4 || audit[3].Action != "submission.rejected" {
					t.Fatalf("missing validation rejection audit: %+v", audit)
				}
				for _, result := range []*httptest.ResponseRecorder{response, submissionsResponse, auditResponse} {
					if strings.Contains(result.Body.String(), "SECRET_SKILL_CONTENT") {
						t.Fatal("skill content leaked into diagnostics or audit")
					}
				}
			})
		}
	}
}
