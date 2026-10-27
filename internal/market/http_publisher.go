package market

import (
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Owner pages are bounded independently from the public catalog.
const (
	publisherPageLimit = 24
	publisherPageMax   = 50
	publisherOffsetMax = 10000
)

// inspectUpload reads exactly one package part; inspection never touches the
// repository or the artifact store, so a rejected pre-flight leaves no trace.
func inspectUpload(w http.ResponseWriter, r *http.Request) (string, error) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxArtifactBytes+(64<<10))
	reader, err := r.MultipartReader()
	if err != nil {
		return "", ErrInvalid
	}
	path := ""
	success := false
	defer func() {
		if !success {
			removeUpload(path)
		}
	}()
	parts := 0
	for {
		part, partErr := reader.NextPart()
		if errors.Is(partErr, io.EOF) {
			break
		}
		if partErr != nil {
			return path, ErrInvalid
		}
		if parts >= 1 || part.FormName() != "package" {
			part.Close()
			return path, ErrInvalid
		}
		parts++
		path, err = saveUpload(part)
		part.Close()
		if err != nil {
			return path, err
		}
	}
	if path == "" {
		return path, ErrInvalid
	}
	success = true
	return path, nil
}

// inspect reports package identity before publishing. Namespace and role
// mismatches are advisory (canPublish false) rather than transport errors so the
// publish page can explain why; malformed archives stay 400 artifact_invalid.
func (s *Server) inspect(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(w, r)
	if !ok {
		return
	}
	select {
	case s.uploadSlots <- struct{}{}:
		defer func() { <-s.uploadSlots }()
	default:
		writeAPIError(w, http.StatusServiceUnavailable, "upload_busy")
		return
	}
	path, err := inspectUpload(w, r)
	if err != nil {
		writeError(w, err)
		return
	}
	defer removeUpload(path)
	validated, err := ValidatePackage(r.Context(), path)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "artifact_invalid")
		return
	}
	report := PackageInspection{CanPublish: true, PluginID: validated.ID, Version: validated.Version, Name: validated.Name,
		Description: validated.Description, Category: categoryFromManifest(validated.Manifest), SizeBytes: validated.SizeBytes,
		MinHostVersion: validated.MinHostVersion, Platforms: validated.Platforms, SHA256: validated.SHA256, Manifest: validated.Manifest}
	if report.Platforms == nil {
		report.Platforms = []string{}
	}
	authorized := (a.Role == "publisher" || a.Role == "admin") && a.PublisherID != "" && strings.HasPrefix(validated.ID, a.PublisherID+".")
	if !authorized {
		report.CanPublish = false
		report.Reason = "forbidden"
	}
	writeJSON(w, http.StatusOK, report)
}

func parsePublisherQuery(v url.Values) (PublisherQuery, error) {
	q := PublisherQuery{Limit: publisherPageLimit, PluginID: strings.TrimSpace(v.Get("pluginId"))}
	if raw := v.Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > publisherPageMax {
			return q, ErrInvalid
		}
		q.Limit = limit
	}
	if raw := v.Get("cursor"); raw != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		if err != nil {
			return q, ErrInvalid
		}
		q.Offset, err = strconv.Atoi(string(decoded))
		if err != nil {
			return q, ErrInvalid
		}
	}
	if q.Offset < 0 || q.Offset > publisherOffsetMax {
		return q, ErrInvalid
	}
	if q.PluginID != "" && !validPluginID(q.PluginID) {
		return q, ErrInvalid
	}
	return q, nil
}

// publishCursor encodes the next owner-page offset; an empty result ends paging.
func publishCursor(offset, limit, rows int) string {
	if rows <= limit {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset + limit)))
}

func (s *Server) publisherPlugins(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(w, r)
	if !ok {
		return
	}
	q, err := parsePublisherQuery(r.URL.Query())
	if err != nil {
		writeError(w, err)
		return
	}
	page, err := s.repo.PublisherPlugins(r.Context(), a, q)
	if err != nil {
		writeError(w, err)
		return
	}
	if page.Items == nil {
		page.Items = []PublisherPlugin{}
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) publisherSubmissions(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(w, r)
	if !ok {
		return
	}
	q, err := parsePublisherQuery(r.URL.Query())
	if err != nil {
		writeError(w, err)
		return
	}
	page, err := s.repo.PublisherSubmissions(r.Context(), a, q)
	if err != nil {
		writeError(w, err)
		return
	}
	if page.Items == nil {
		page.Items = []Submission{}
	}
	writeJSON(w, http.StatusOK, page)
}

// publisherSource sets or clears the GitHub repository used for auto-sync.
// Clearing is an explicit repository operation so source validation stays strict.
func (s *Server) publisherSource(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	var body struct {
		SourceURL string `json:"sourceUrl"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, err)
		return
	}
	var err error
	if body.SourceURL == "" {
		err = s.repo.ClearPluginSource(r.Context(), a, id)
	} else {
		err = s.repo.SetPluginSource(r.Context(), a, id, body.SourceURL)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"sourceUrl": body.SourceURL})
}

// publisherDelete removes one plugin owned by the caller; administrators may
// delete any plugin. account() enforces session auth and cookie CSRF.
func (s *Server) publisherDelete(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(w, r)
	if !ok {
		return
	}
	if err := s.repo.DeletePlugin(r.Context(), a, r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
