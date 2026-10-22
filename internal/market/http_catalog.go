package market

import (
	"bufio"
	"fmt"
	"io"
	"net/http"

	"GoNavi-Wails/internal/logger"
)

func (s *Server) decorate(p *MarketPlugin) {
	if p.Artifact != nil {
		s.decorateArtifact(p.Artifact)
	}
}

func (s *Server) decorateArtifact(a *Artifact) { a.URL = s.publicURL + "/api/v1/artifacts/" + a.SHA256 }

func (s *Server) catalog(w http.ResponseWriter, r *http.Request) {
	q, err := parseCatalogQuery(r.URL.Query())
	if err != nil {
		writeError(w, err)
		return
	}
	page, err := s.repo.Catalog(r.Context(), q)
	if err != nil {
		writeError(w, err)
		return
	}
	for i := range page.Items {
		s.decorate(&page.Items[i])
	}
	if page.Items == nil {
		page.Items = []MarketPlugin{}
	}
	writeJSON(w, 200, page)
}

func (s *Server) detail(w http.ResponseWriter, r *http.Request) {
	item, err := s.repo.Plugin(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	s.decorate(&item)
	writeJSON(w, 200, item)
}

func (s *Server) versions(w http.ResponseWriter, r *http.Request) {
	items, err := s.repo.Versions(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	for i := range items {
		s.decorate(&items[i])
	}
	writeJSON(w, 200, items)
}

func (s *Server) artifactDescriptor(w http.ResponseWriter, r *http.Request) {
	a, err := s.repo.Artifact(r.Context(), r.PathValue("id"), r.PathValue("version"), r.URL.Query().Get("platform"))
	if err != nil {
		writeError(w, err)
		return
	}
	s.decorateArtifact(&a)
	writeJSON(w, 200, a)
}

func (s *Server) download(w http.ResponseWriter, r *http.Request) {
	digest := r.PathValue("digest")
	if !digestPattern.MatchString(digest) {
		writeError(w, ErrNotFound)
		return
	}
	a, err := s.repo.PublishedArtifact(r.Context(), digest)
	if err != nil {
		writeError(w, err)
		return
	}
	s.writeArtifact(w, r, a, true)
}

func (s *Server) acquireArtifactSlot(w http.ResponseWriter) bool {
	select {
	case s.artifactSlots <- struct{}{}:
		return true
	default:
		w.Header().Set("Retry-After", "5")
		writeAPIError(w, 503, "artifact_busy")
		return false
	}
}

func (s *Server) writeArtifact(w http.ResponseWriter, r *http.Request, a Artifact, countDownload bool) {
	if !s.acquireArtifactSlot(w) {
		return
	}
	defer func() { <-s.artifactSlots }()
	digest := a.SHA256
	source, err := s.artifacts.Open(r.Context(), digest)
	if err != nil {
		writeError(w, err)
		return
	}
	defer source.Close()
	reader := bufio.NewReader(source)
	magic, err := reader.Peek(2)
	if err != nil {
		writeError(w, err)
		return
	}
	suffix, contentType := ".zip", "application/zip"
	if magic[0] == 0x1f && magic[1] == 0x8b {
		suffix, contentType = ".tgz", "application/gzip"
	}
	if r.Method != "HEAD" && countDownload {
		if err = s.repo.CountDownload(r.Context(), digest); err != nil {
			writeError(w, err)
			return
		}
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", fmt.Sprint(a.SizeBytes))
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s%s", digest, suffix))
	w.Header().Set("ETag", fmt.Sprintf("%q", digest))
	w.WriteHeader(200)
	if r.Method == "HEAD" {
		return
	}
	if _, err = io.CopyN(w, reader, a.SizeBytes); err != nil {
		logger.Warnf("market artifact transfer interrupted")
	}
}

func (s *Server) ratings(w http.ResponseWriter, r *http.Request) {
	ratings, err := s.repo.Ratings(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	if ratings == nil {
		ratings = []Rating{}
	}
	writeJSON(w, 200, ratings)
}

func (s *Server) rate(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(w, r)
	if !ok {
		return
	}
	var body struct {
		Stars   int    `json:"stars"`
		Body    string `json:"body"`
		Version string `json:"version"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, err)
		return
	}
	result, err := s.repo.PutRating(r.Context(), a, Rating{PluginID: r.PathValue("id"), Stars: body.Stars, Body: body.Body, Version: body.Version})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, result)
}

func (s *Server) deleteRating(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(w, r)
	if !ok {
		return
	}
	if err := s.repo.DeleteRating(r.Context(), a, r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"deleted": true})
}

func (s *Server) report(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(w, r)
	if !ok {
		return
	}
	var body Report
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, err)
		return
	}
	if err := s.repo.Report(r.Context(), a, body); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 201, map[string]bool{"accepted": true})
}
