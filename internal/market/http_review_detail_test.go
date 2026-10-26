package market

import (
	"bytes"
	"context"
	"testing"
)

func (m *memoryRepo) SubmissionDetail(ctx context.Context, a Account, id string) (ReviewDetail, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if a.Role != "admin" {
		return ReviewDetail{}, ErrForbidden
	}
	v, ok := m.releases[id]
	if !ok {
		return ReviewDetail{}, ErrNotFound
	}
	detail := ReviewDetail{Submission: v.submission, Manifest: append([]byte(nil), v.packageData.Manifest...)}
	if v.packageData.SHA256 != "" {
		detail.Artifact = &Artifact{SHA256: v.packageData.SHA256, SizeBytes: v.packageData.SizeBytes, Platform: "any", Version: v.packageData.Version}
	}
	return detail, nil
}

func TestAdminSupervisionDetailAndArtifact(t *testing.T) {
	f := newHTTPFixture(t)
	archive := archiveFixture(t, "acme.example", "1.0.0", "")
	response := f.upload(t, "acme.example", "1.0.0", "publisher", archive, nil)
	assertStatus(t, response, 201)
	submission := decodeResponse[Submission](t, response)
	path := "/admin/submissions/" + submission.ID
	assertStatus(t, f.request("GET", path, "publisher", nil), 403)
	assertStatus(t, f.request("GET", path+"/artifact", "", nil), 401)
	preview := decodeResponse[ReviewDetail](t, f.request("GET", path, "admin", nil))
	if len(preview.Manifest) == 0 || preview.Artifact == nil || preview.Artifact.SHA256 != submission.SHA256 {
		t.Fatal("supervision preview is incomplete")
	}
	download := f.request("GET", path+"/artifact", "admin", nil)
	assertStatus(t, download, 200)
	if !bytes.Equal(download.Body.Bytes(), archive) {
		t.Fatal("supervision bytes differ from published bytes")
	}
	if f.repo.downloads["acme.example"] != 0 {
		t.Fatal("private supervision counted as public download")
	}
	publicDownload := f.request("GET", "/artifacts/"+submission.SHA256, "", nil)
	assertStatus(t, publicDownload, 200)
	if !bytes.Equal(publicDownload.Body.Bytes(), archive) {
		t.Fatal("published artifact differs from submitted archive")
	}
}
