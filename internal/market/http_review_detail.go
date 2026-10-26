package market

import "net/http"

func (s *Server) adminSubmission(w http.ResponseWriter, r *http.Request) {
	a, ok := s.admin(w, r)
	if !ok {
		return
	}
	detail, err := s.repo.SubmissionDetail(r.Context(), a, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	if detail.Artifact != nil {
		detail.Artifact.URL = s.publicURL + "/api/v1/admin/submissions/" + detail.Submission.ID + "/artifact"
	}
	writeJSON(w, 200, detail)
}

func (s *Server) adminArtifact(w http.ResponseWriter, r *http.Request) {
	a, ok := s.admin(w, r)
	if !ok {
		return
	}
	detail, err := s.repo.SubmissionDetail(r.Context(), a, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	if detail.Artifact == nil {
		writeError(w, ErrNotFound)
		return
	}
	s.writeArtifact(w, r, *detail.Artifact, false)
}
