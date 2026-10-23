package market

import (
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strings"

	"GoNavi-Wails/internal/logger"
)

type uploadedPackage struct{ Path, PluginID, Version string }

func removeUpload(path string) {
	if path == "" {
		return
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		logger.Warnf("market upload cleanup failed")
	}
}

func receiveUpload(w http.ResponseWriter, r *http.Request) (uploadedPackage, error) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxArtifactBytes+(64<<10))
	reader, err := r.MultipartReader()
	if err != nil {
		return uploadedPackage{}, ErrInvalid
	}
	var upload uploadedPackage
	success := false
	defer func() {
		if !success {
			removeUpload(upload.Path)
		}
	}()
	seen := make(map[string]bool)
	for count := 0; ; count++ {
		part, partErr := reader.NextPart()
		if errors.Is(partErr, io.EOF) {
			break
		}
		if partErr != nil || count >= 3 {
			return upload, ErrInvalid
		}
		name := part.FormName()
		if seen[name] {
			part.Close()
			return upload, ErrInvalid
		}
		seen[name] = true
		if name == "package" {
			upload.Path, err = saveUpload(part)
		} else if name == "pluginId" || name == "version" {
			var value []byte
			value, err = io.ReadAll(io.LimitReader(part, 1025))
			if len(value) > 1024 {
				err = ErrInvalid
			}
			if name == "pluginId" {
				upload.PluginID = string(value)
			} else {
				upload.Version = string(value)
			}
		} else {
			err = ErrInvalid
		}
		part.Close()
		if err != nil {
			return upload, err
		}
	}
	if upload.Path == "" || !validPluginID(upload.PluginID) || !validVersion(upload.Version) {
		return upload, ErrInvalid
	}
	success = true
	return upload, nil
}

func saveUpload(part *multipart.Part) (string, error) {
	name := strings.ToLower(part.FileName())
	suffix := ".zip"
	if strings.HasSuffix(name, ".tgz") || strings.HasSuffix(name, ".tar.gz") {
		suffix = ".tgz"
	} else if !strings.HasSuffix(name, ".zip") {
		return "", ErrInvalid
	}
	f, err := os.CreateTemp("", "gonavi-market-upload-*"+suffix)
	if err != nil {
		return "", err
	}
	size, copyErr := io.Copy(f, io.LimitReader(part, MaxArtifactBytes+1))
	closeErr := f.Close()
	if copyErr != nil || closeErr != nil || size == 0 || size > MaxArtifactBytes {
		removeUpload(f.Name())
		return "", ErrInvalid
	}
	return f.Name(), nil
}

func (s *Server) submit(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(w, r)
	if !ok {
		return
	}
	if a.Role != "publisher" && a.Role != "admin" {
		writeError(w, ErrForbidden)
		return
	}
	select {
	case s.uploadSlots <- struct{}{}:
		defer func() { <-s.uploadSlots }()
	default:
		writeAPIError(w, 503, "upload_busy")
		return
	}
	if !s.acquireArtifactSlot(w) {
		return
	}
	defer func() { <-s.artifactSlots }()
	upload, err := receiveUpload(w, r)
	if err != nil {
		writeError(w, err)
		return
	}
	defer removeUpload(upload.Path)
	submission, err := s.repo.BeginSubmission(r.Context(), a, upload.PluginID, upload.Version)
	if err != nil {
		writeError(w, err)
		return
	}
	for _, state := range []string{"submitted", "validating"} {
		submission, err = s.repo.AdvanceSubmission(r.Context(), a, submission.ID, state, "")
		if err != nil {
			writeError(w, err)
			return
		}
	}
	validated, err := ValidatePackage(r.Context(), upload.Path)
	if err != nil || validated.ID != upload.PluginID || validated.Version != upload.Version {
		s.failValidation(r, a, submission.ID, "artifact_validation_failed")
		writeAPIError(w, 400, "artifact_invalid")
		return
	}
	if err = s.storeUpload(r, upload.Path, validated); err != nil {
		s.failValidation(r, a, submission.ID, "artifact_storage_failed")
		writeError(w, err)
		return
	}
	submission, err = s.repo.ValidateSubmission(r.Context(), a, submission.ID, validated)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 201, submission)
}

func (s *Server) storeUpload(r *http.Request, path string, p ValidatedPackage) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return s.artifacts.Put(r.Context(), p.SHA256, f, p.SizeBytes)
}

func (s *Server) failValidation(r *http.Request, a Account, id, reason string) {
	if _, err := s.repo.AdvanceSubmission(r.Context(), a, id, "rejected", reason); err != nil {
		logger.Warnf("market failed to record validation rejection")
	}
}

func (s *Server) submissions(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(w, r)
	if !ok {
		return
	}
	s.listSubmissions(w, r, a)
}

func (s *Server) adminSubmissions(w http.ResponseWriter, r *http.Request) {
	a, ok := s.admin(w, r)
	if !ok {
		return
	}
	s.listSubmissions(w, r, a)
}

func (s *Server) listSubmissions(w http.ResponseWriter, r *http.Request, a Account) {
	items, err := s.repo.Submissions(r.Context(), a)
	if err != nil {
		writeError(w, err)
		return
	}
	if items == nil {
		items = []Submission{}
	}
	writeJSON(w, 200, items)
}

func (s *Server) review(w http.ResponseWriter, r *http.Request) {
	a, ok := s.admin(w, r)
	if !ok {
		return
	}
	action := r.PathValue("action")
	if action != "approve" && action != "reject" && action != "yank" {
		writeError(w, ErrNotFound)
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, err)
		return
	}
	item, err := s.repo.Review(r.Context(), a, r.PathValue("id"), action, body.Reason)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, item)
}

func (s *Server) audit(w http.ResponseWriter, r *http.Request) {
	a, ok := s.admin(w, r)
	if !ok {
		return
	}
	items, err := s.repo.Audits(r.Context(), a)
	if err != nil {
		writeError(w, err)
		return
	}
	if items == nil {
		items = []Audit{}
	}
	writeJSON(w, 200, items)
}

func (s *Server) hideRating(w http.ResponseWriter, r *http.Request) {
	a, ok := s.admin(w, r)
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, err)
		return
	}
	if err := s.repo.HideRating(r.Context(), a, r.PathValue("id"), r.PathValue("user"), body.Reason); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"hidden": true})
}
