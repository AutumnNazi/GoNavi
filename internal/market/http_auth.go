package market

import "net/http"

// session resolves the caller's identity for an operator bearer token or a
// website session cookie and returns the stored account record.
func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	account, ok := s.account(w, r)
	if ok {
		writeJSON(w, http.StatusOK, account)
	}
}

// logout revokes the presented session. Operator tokens are revoked by hash;
// website cookies must pass the CSRF check enforced by authorize first.
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	auth, ok := s.authorize(w, r)
	if !ok {
		return
	}
	if err := s.repo.RevokeSession(r.Context(), secretHash(auth.token)); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"revoked": true})
}
