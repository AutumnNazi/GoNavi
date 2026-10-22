package pluginmarket

import (
	"context"
	"errors"
	"net/http"
	"time"
)

type pendingLogin struct {
	source         sourceSnapshot
	authGeneration uint64
	expiresAt      time.Time
	interval       time.Duration
	nextPoll       time.Time
	polling        bool
}

type deviceToken struct {
	Status       string `json:"status"`
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int    `json:"expiresIn"`
}

// Login starts a real service device authorization and validates its same-origin browser URL.
func (s *Service) Login(ctx context.Context) (DeviceAuthorization, error) {
	source, err := s.snapshot()
	if err != nil {
		return DeviceAuthorization{}, err
	}
	s.mu.Lock()
	authGeneration := s.authGeneration
	s.mu.Unlock()
	var challenge DeviceAuthorization
	if err = s.requestJSON(ctx, source, http.MethodPost, "/auth/device", nil, nil, &challenge, ""); err != nil {
		return DeviceAuthorization{}, err
	}
	verification, err := sameOrigin(source.base, challenge.VerificationURI)
	if err != nil || challenge.VerificationURI == "" || !validToken(challenge.DeviceCode) || len(challenge.DeviceCode) > 512 ||
		len(challenge.UserCode) == 0 || len(challenge.UserCode) > 128 || challenge.IntervalSeconds < 1 || challenge.IntervalSeconds > 60 ||
		challenge.ExpiresIn < 1 || challenge.ExpiresIn > 3600 {
		return DeviceAuthorization{}, ErrInvalidResponse
	}
	challenge.VerificationURI = verification
	s.mu.Lock()
	defer s.mu.Unlock()
	if err = s.checkSourceLocked(source); err != nil {
		return DeviceAuthorization{}, err
	}
	if authGeneration != s.authGeneration {
		return DeviceAuthorization{}, ErrUnknownDeviceCode
	}
	for code, pending := range s.pending {
		if !pending.expiresAt.After(s.now()) {
			delete(s.pending, code)
		}
	}
	if len(s.pending) >= 8 {
		return DeviceAuthorization{}, ErrInvalidRequest
	}
	s.pending[challenge.DeviceCode] = pendingLogin{source: source, authGeneration: authGeneration,
		expiresAt: s.now().Add(time.Duration(challenge.ExpiresIn) * time.Second), interval: time.Duration(challenge.IntervalSeconds) * time.Second}
	return challenge, nil
}

// PollLogin polls only locally issued, source-bound grants and stores authorized tokens exclusively in SecretStore.
// Calls before the next permitted poll return pending without sending another network request.
func (s *Service) PollLogin(ctx context.Context, deviceCode string) (LoginStatus, error) {
	if err := ctx.Err(); err != nil {
		return LoginStatus{}, err
	}
	pending, shouldPoll, status, err := s.beginPoll(deviceCode)
	if err != nil || !shouldPoll {
		return status, err
	}
	var response deviceToken
	body := struct {
		DeviceCode string `json:"deviceCode"`
	}{DeviceCode: deviceCode}
	err = s.requestJSON(ctx, pending.source, http.MethodPost, "/auth/device/token", nil, body, &response, "")
	status, token, err := s.finishPoll(deviceCode, pending, response, err)
	if err != nil || token == nil {
		return status, err
	}
	if err = s.storeAuthorized(ctx, pending, *token); err != nil {
		return LoginStatus{}, err
	}
	return status, nil
}

func (s *Service) finishPoll(code string, pending pendingLogin, response deviceToken, requestErr error) (LoginStatus, *storedToken, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, exists := s.pending[code]
	if !exists || current.authGeneration != pending.authGeneration || s.authGeneration != pending.authGeneration {
		return LoginStatus{}, nil, ErrUnknownDeviceCode
	}
	if err := s.checkSourceLocked(pending.source); err != nil {
		return LoginStatus{}, nil, err
	}
	current.polling = false
	current.nextPoll = s.now().Add(current.interval)
	s.pending[code] = current
	if requestErr != nil {
		var api *APIError
		if errors.As(requestErr, &api) && api.StatusCode == http.StatusTooManyRequests && api.Code == "slow_down" {
			return LoginStatus{Status: "pending"}, nil, nil
		}
		return LoginStatus{}, nil, requestErr
	}
	return s.completePoll(code, current, response)
}
func (s *Service) beginPoll(code string) (pendingLogin, bool, LoginStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	pending, exists := s.pending[code]
	if !exists {
		return pendingLogin{}, false, LoginStatus{}, ErrUnknownDeviceCode
	}
	if !pending.expiresAt.After(s.now()) {
		delete(s.pending, code)
		return pending, false, LoginStatus{Status: "expired"}, nil
	}
	if err := s.checkSourceLocked(pending.source); err != nil {
		return pending, false, LoginStatus{}, err
	}
	if pending.polling || s.now().Before(pending.nextPoll) {
		return pending, false, LoginStatus{Status: "pending"}, nil
	}
	pending.polling = true
	s.pending[code] = pending
	return pending, true, LoginStatus{}, nil
}

func (s *Service) completePoll(code string, pending pendingLogin, response deviceToken) (LoginStatus, *storedToken, error) {
	switch response.Status {
	case "pending":
		if response.AccessToken != "" || response.RefreshToken != "" {
			return LoginStatus{}, nil, ErrInvalidResponse
		}
	case "denied", "expired":
		delete(s.pending, code)
	case "authorized":
		delete(s.pending, code)
		if !validToken(response.AccessToken) || (response.RefreshToken != "" && !validToken(response.RefreshToken)) ||
			response.ExpiresIn < 1 || response.ExpiresIn > 30*24*60*60 || !pending.expiresAt.After(s.now()) {
			return LoginStatus{}, nil, ErrInvalidResponse
		}
		token := &storedToken{AccessToken: response.AccessToken, RefreshToken: response.RefreshToken,
			ExpiresAt: s.now().Add(time.Duration(response.ExpiresIn) * time.Second)}
		return LoginStatus{Status: "authorized"}, token, nil
	default:
		return LoginStatus{}, nil, ErrInvalidResponse
	}
	return LoginStatus{Status: response.Status}, nil, nil
}

func (s *Service) storeAuthorized(ctx context.Context, pending pendingLogin, token storedToken) error {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.checkAuthorization(pending); err != nil {
		return err
	}
	if err := s.saveToken(pending.source.id, token); err != nil {
		return err
	}
	// Keychain operations cannot be canceled. Fence again after storage and erase a canceled grant before returning.
	if err := s.checkAuthorization(pending); err != nil {
		return errors.Join(err, s.deleteToken(pending.source.id))
	}
	if err := ctx.Err(); err != nil {
		return errors.Join(err, s.deleteToken(pending.source.id))
	}
	if !token.ExpiresAt.After(s.now()) {
		return errors.Join(ErrUnauthenticated, s.deleteToken(pending.source.id))
	}
	return nil
}

func (s *Service) checkAuthorization(pending pendingLogin) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.checkSourceLocked(pending.source); err != nil {
		return err
	}
	if pending.authGeneration != s.authGeneration {
		return ErrUnknownDeviceCode
	}
	return nil
}

// Logout clears local credentials and pending grants even if remote revocation fails.
// A returned error means revocation or secure deletion failed, not that the old login is retained in memory.
func (s *Service) Logout(ctx context.Context) error {
	s.mu.Lock()
	source := s.snapshotLocked()
	s.authGeneration++
	clear(s.pending)
	if source.base == "" {
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()
	s.authMu.Lock()
	token, loadErr := s.loadToken(source.id)
	deleteErr := s.deleteToken(source.id)
	s.authMu.Unlock()
	if errors.Is(loadErr, ErrUnauthenticated) {
		loadErr = nil
	}
	var revokeErr error
	if token.AccessToken != "" {
		revokeErr = s.requestJSON(ctx, source, http.MethodPost, "/auth/logout", nil, nil, nil, token.AccessToken)
	}
	return errors.Join(loadErr, deleteErr, revokeErr)
}
