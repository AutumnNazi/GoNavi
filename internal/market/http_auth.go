package market

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"
)

// DeviceAuthorization is the desktop login challenge, not a successful authentication.
type DeviceAuthorization struct {
	DeviceCode      string `json:"deviceCode"`
	UserCode        string `json:"userCode"`
	VerificationURI string `json:"verificationUri"`
	IntervalSeconds int    `json:"intervalSeconds"`
	ExpiresIn       int    `json:"expiresIn"`
}

// DeviceToken contains a bearer token only after explicit authorization is consumed.
type DeviceToken struct {
	Status      string `json:"status"`
	AccessToken string `json:"accessToken,omitempty"`
	ExpiresIn   int    `json:"expiresIn,omitempty"`
}

func (s *Server) authAvailable(w http.ResponseWriter) bool {
	if s.identity == nil {
		writeAPIError(w, 503, "auth_unavailable")
		return false
	}
	return true
}

func (s *Server) startDevice(w http.ResponseWriter, r *http.Request) {
	if !s.authAvailable(w) {
		return
	}
	code, err := newSecret(32)
	if err != nil {
		writeError(w, err)
		return
	}
	random := make([]byte, 5)
	if _, err = rand.Read(random); err != nil {
		writeError(w, err)
		return
	}
	raw := hex.EncodeToString(random)
	userCode := normalizeUserCode(raw[:5] + "-" + raw[5:])
	now := s.now()
	d := DeviceGrant{CodeHash: secretHash(code), UserCodeHash: secretHash(userCode), State: "pending", ExpiresAt: now.Add(10 * time.Minute), NextPollAt: now}
	if err = s.repo.CreateDevice(r.Context(), d); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 201, DeviceAuthorization{DeviceCode: code, UserCode: userCode, VerificationURI: s.publicURL + "/api/v1/auth/device", IntervalSeconds: 5, ExpiresIn: 600})
}

func (s *Server) pollDevice(w http.ResponseWriter, r *http.Request) {
	if !s.authAvailable(w) {
		return
	}
	var body struct {
		DeviceCode string `json:"deviceCode"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, err)
		return
	}
	if len(body.DeviceCode) != 43 {
		writeError(w, ErrInvalid)
		return
	}
	token, err := newSecret(32)
	if err != nil {
		writeError(w, err)
		return
	}
	now := s.now()
	status, err := s.repo.PollDevice(r.Context(), secretHash(body.DeviceCode), secretHash(token), now, now.Add(24*time.Hour))
	if err != nil {
		writeError(w, err)
		return
	}
	if status == "slow_down" {
		w.Header().Set("Retry-After", "5")
		writeAPIError(w, 429, "slow_down")
		return
	}
	result := DeviceToken{Status: status}
	if status == "authorized" {
		result.AccessToken = token
		result.ExpiresIn = 86400
	}
	writeJSON(w, 200, result)
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	account, ok := s.account(w, r)
	if ok {
		writeJSON(w, 200, account)
	}
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.account(w, r); !ok {
		return
	}
	if err := s.repo.RevokeSession(r.Context(), secretHash(bearer(r))); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"revoked": true})
}
