package pluginmarket

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func writeSubmitArchive(t *testing.T, filename string, manifest string, withManifest bool) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), filename)
	if filepath.Ext(filename) == ".zip" {
		file, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		writer := zip.NewWriter(file)
		if withManifest {
			entry, err := writer.Create("gonavi.plugin.json")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = entry.Write([]byte(manifest)); err != nil {
				t.Fatal(err)
			}
		}
		binary, err := writer.Create("bin/plugin")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = binary.Write([]byte("payload")); err != nil {
			t.Fatal(err)
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		return path
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	gzipWriter := gzip.NewWriter(file)
	tarWriter := tar.NewWriter(gzipWriter)
	if withManifest {
		if err = tarWriter.WriteHeader(&tar.Header{Name: "gonavi.plugin.json", Mode: 0o600, Size: int64(len(manifest))}); err != nil {
			t.Fatal(err)
		}
		if _, err = tarWriter.Write([]byte(manifest)); err != nil {
			t.Fatal(err)
		}
	}
	if err = tarWriter.WriteHeader(&tar.Header{Name: "bin/plugin", Mode: 0o755, Size: int64(len("payload"))}); err != nil {
		t.Fatal(err)
	}
	if _, err = tarWriter.Write([]byte("payload")); err != nil {
		t.Fatal(err)
	}
	if err = tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err = gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestReadArchiveIdentity(t *testing.T) {
	manifest := `{"id":"gh-author.tool","version":"1.0.0","name":"Tool"}`
	cases := []struct {
		name       string
		format     string
		withEntry  bool
		extension  string
		wantID     string
		wantErrIs  error
		wantNilErr bool
	}{
		{name: "zip archive", format: "plugin.zip", withEntry: true, extension: ".zip", wantID: "gh-author.tool", wantNilErr: true},
		{name: "tgz archive", format: "plugin.tgz", withEntry: true, extension: ".tgz", wantID: "gh-author.tool", wantNilErr: true},
		{name: "missing manifest", format: "plugin.zip", withEntry: false, extension: ".zip", wantErrIs: ErrInvalidResponse},
		{name: "unsupported extension", format: "plugin.zip", withEntry: true, extension: ".rar", wantErrIs: ErrInvalidRequest},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			path := writeSubmitArchive(t, test.format, manifest, test.withEntry)
			if test.extension != ".zip" && test.extension != ".tgz" && test.extension != ".tar.gz" {
				renamed := filepath.Join(t.TempDir(), "plugin"+test.extension)
				if err := os.Rename(path, renamed); err != nil {
					t.Fatal(err)
				}
				path = renamed
			}
			identity, err := readArchiveIdentity(path)
			if test.wantNilErr {
				if err != nil || identity.ID != test.wantID || identity.Version != "1.0.0" {
					t.Fatalf("identity=%+v err=%v", identity, err)
				}
				return
			}
			assertErrorIs(t, err, test.wantErrIs)
		})
	}
}

func TestSubmitUploadsPackageAndPublishes(t *testing.T) {
	manifest := `{"id":"gh-author.tool","version":"1.2.0","name":"Tool"}`
	var sawAuth, sawContentType bool
	var sawPluginID, sawVersion string
	var packageBytes []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/submissions" || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			writeTestJSON(t, w, 404, map[string]string{"code": "not_found"})
			return
		}
		sawAuth = r.Header.Get("Authorization") == "Bearer submit-token"
		sawContentType = r.Header.Get("Content-Type") != ""
		reader, err := r.MultipartReader()
		if err != nil {
			t.Errorf("multipart reader: %v", err)
			writeTestJSON(t, w, 400, map[string]string{"code": "invalid_request"})
			return
		}
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Errorf("part: %v", err)
				break
			}
			switch part.FormName() {
			case "pluginId":
				value, _ := io.ReadAll(part)
				sawPluginID = string(value)
			case "version":
				value, _ := io.ReadAll(part)
				sawVersion = string(value)
			case "package":
				packageBytes, _ = io.ReadAll(part)
			}
			part.Close()
		}
		writeTestJSON(t, w, 201, Submission{ID: "s1", PluginID: sawPluginID, Version: sawVersion,
			State: "published", PublisherID: "gh-author", SHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"})
	}))
	defer server.Close()
	service, _ := newTestService(t, server.URL, false)
	seedToken(t, service, "submit-token")
	archive := writeSubmitArchive(t, "plugin.zip", manifest, true)
	expected, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	submission, err := service.Submit(t.Context(), archive, "")
	if err != nil {
		t.Fatal(err)
	}
	if !sawAuth || !sawContentType {
		t.Fatalf("auth=%v contentType=%v", sawAuth, sawContentType)
	}
	if sawPluginID != "gh-author.tool" || sawVersion != "1.2.0" {
		t.Fatalf("form pluginId=%q version=%q", sawPluginID, sawVersion)
	}
	if !bytes.Equal(packageBytes, expected) {
		t.Fatal("package bytes changed during upload")
	}
	if submission.State != "published" || submission.ID != "s1" {
		t.Fatalf("submission=%+v", submission)
	}
}

func TestSubmitRequiresAuthentication(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("server must not be called without a token")
	}))
	defer server.Close()
	service, _ := newTestService(t, server.URL, false)
	archive := writeSubmitArchive(t, "plugin.zip", `{"id":"gh-author.tool","version":"1.0.0"}`, true)
	_, err := service.Submit(t.Context(), archive, "")
	assertErrorIs(t, err, ErrUnauthenticated)
}

func multipartReaderFromBytes(data []byte, contentType string) (*multipart.Reader, error) {
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return nil, err
	}
	return multipart.NewReader(bytes.NewReader(data), params["boundary"]), nil
}

func TestBuildSubmissionBodyFields(t *testing.T) {
	manifest := `{"id":"gh-author.tool","version":"1.0.0"}`
	archive := writeSubmitArchive(t, "plugin.zip", manifest, true)
	body, contentType, err := buildSubmissionBody(archive, archiveIdentity{ID: "gh-author.tool", Version: "1.0.0"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if contentType == "" {
		t.Fatal("missing multipart content type")
	}
	parsed, err := multipartReaderFromBytes(body.Bytes(), contentType)
	if err != nil {
		t.Fatal(err)
	}
	fields := map[string]string{}
	for {
		part, err := parsed.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		value, err := io.ReadAll(part)
		if err != nil {
			t.Fatal(err)
		}
		if name := part.FormName(); name != "package" {
			fields[name] = string(value)
		} else if len(value) == 0 {
			t.Fatal("package part is empty")
		}
		part.Close()
	}
	if fields["pluginId"] != "gh-author.tool" || fields["version"] != "1.0.0" {
		t.Fatalf("fields=%+v", fields)
	}
}
