package pluginmarket

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	maxSubmitArchiveBytes  = 64 << 20
	maxSubmitManifestBytes = 256 << 10
	manifestEntryName      = "gonavi.plugin.json"
)

// httpsRepositoryPattern matches canonical GitHub repository URLs the market
// accepts as auto-sync sources (https://github.com/owner/repo with optional
// trailing slash); it mirrors the service-side parser.
var httpsRepositoryPattern = regexp.MustCompile(`^https://github\.com/[A-Za-z0-9-]+/[A-Za-z0-9_.-]+/?$`)

// Submission mirrors the service-owned state of one uploaded package version.
type Submission struct {
	ID          string `json:"id"`
	PluginID    string `json:"pluginId"`
	Version     string `json:"version"`
	State       string `json:"state"`
	PublisherID string `json:"publisherId"`
	Reason      string `json:"reason,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
}

// Submit uploads one prebuilt plugin archive to the selected source with the
// logged-in session. The service performs every validation and owns publishing;
// this side only reads the manifest identity to keep the form consistent.
// A non-empty sourceURL registers the GitHub repository whose latest release
// the market then tracks for automatic updates.
func (s *Service) Submit(ctx context.Context, archivePath, sourceURL string) (Submission, error) {
	source, err := s.snapshot()
	if err != nil {
		return Submission{}, err
	}
	identity, err := readArchiveIdentity(archivePath)
	if err != nil {
		return Submission{}, err
	}
	if !validID(identity.ID) || !validVersion(identity.Version) {
		return Submission{}, ErrInvalidRequest
	}
	if sourceURL != "" && !httpsRepositoryPattern.MatchString(sourceURL) {
		return Submission{}, ErrInvalidRequest
	}
	token, err := s.authenticatedToken(source)
	if err != nil {
		return Submission{}, err
	}
	body, contentType, err := buildSubmissionBody(archivePath, identity, sourceURL)
	if err != nil {
		return Submission{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL(source, "/submissions", nil), body)
	if err != nil {
		return Submission{}, &requestError{cause: err}
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := s.client.Do(request)
	if err != nil {
		return Submission{}, &requestError{cause: err}
	}
	defer response.Body.Close()
	data, err := readBounded(response.Body, maxJSONBytes)
	if err != nil {
		return Submission{}, &requestError{cause: err}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Submission{}, responseError(response.StatusCode, data)
	}
	var submission Submission
	if err = json.Unmarshal(data, &submission); err != nil {
		return Submission{}, ErrInvalidResponse
	}
	if err = s.checkSource(source); err != nil {
		return Submission{}, err
	}
	return submission, nil
}

type archiveIdentity struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}

// readArchiveIdentity reads only the manifest entry of a zip or tar.gz package
// without extracting or executing anything else.
func readArchiveIdentity(path string) (archiveIdentity, error) {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > maxSubmitArchiveBytes {
		return archiveIdentity{}, ErrInvalidRequest
	}
	manifest, err := readManifestEntry(path)
	if err != nil {
		return archiveIdentity{}, err
	}
	var identity archiveIdentity
	if err = json.Unmarshal(manifest, &identity); err != nil || identity.ID == "" || identity.Version == "" {
		return archiveIdentity{}, ErrInvalidResponse
	}
	return identity, nil
}

func readManifestEntry(path string) ([]byte, error) {
	lower := strings.ToLower(filepath.Base(path))
	switch {
	case strings.HasSuffix(lower, ".zip"):
		reader, err := zip.OpenReader(path)
		if err != nil {
			return nil, ErrInvalidResponse
		}
		defer reader.Close()
		for _, entry := range reader.File {
			if entry.Name != manifestEntryName || entry.FileInfo().IsDir() {
				continue
			}
			file, err := entry.Open()
			if err != nil {
				return nil, ErrInvalidResponse
			}
			defer file.Close()
			return io.ReadAll(io.LimitReader(file, maxSubmitManifestBytes+1))
		}
		return nil, ErrInvalidResponse
	case strings.HasSuffix(lower, ".tgz"), strings.HasSuffix(lower, ".tar.gz"):
		file, err := os.Open(path)
		if err != nil {
			return nil, ErrInvalidRequest
		}
		defer file.Close()
		gzipReader, err := gzip.NewReader(file)
		if err != nil {
			return nil, ErrInvalidResponse
		}
		defer gzipReader.Close()
		tarReader := tar.NewReader(gzipReader)
		for {
			header, err := tarReader.Next()
			if errors.Is(err, io.EOF) {
				return nil, ErrInvalidResponse
			}
			if err != nil {
				return nil, ErrInvalidResponse
			}
			if header.Name == manifestEntryName && header.Typeflag == tar.TypeReg {
				return io.ReadAll(io.LimitReader(tarReader, maxSubmitManifestBytes+1))
			}
		}
	default:
		return nil, ErrInvalidRequest
	}
}

func buildSubmissionBody(archivePath string, identity archiveIdentity, sourceURL string) (*bytes.Buffer, string, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fields := map[string]string{"pluginId": identity.ID, "version": identity.Version}
	if sourceURL != "" {
		fields["source"] = sourceURL
	}
	for name, value := range fields {
		if err := writer.WriteField(name, value); err != nil {
			return nil, "", fmt.Errorf("encode submission field: %w", err)
		}
	}
	file, err := os.Open(archivePath)
	if err != nil {
		return nil, "", ErrInvalidRequest
	}
	defer file.Close()
	part, err := writer.CreateFormFile("package", filepath.Base(archivePath))
	if err != nil {
		return nil, "", fmt.Errorf("encode submission package: %w", err)
	}
	if _, err = io.Copy(part, file); err != nil {
		return nil, "", fmt.Errorf("read submission package: %w", err)
	}
	if err = writer.Close(); err != nil {
		return nil, "", fmt.Errorf("finish submission body: %w", err)
	}
	return &body, writer.FormDataContentType(), nil
}
