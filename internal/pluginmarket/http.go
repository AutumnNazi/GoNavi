package pluginmarket

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
)

func apiURL(source sourceSnapshot, route string, query url.Values) string {
	target := source.base + "/api/v1" + route
	if len(query) != 0 {
		target += "?" + query.Encode()
	}
	return target
}

func (s *Service) requestJSON(ctx context.Context, source sourceSnapshot, method, route string, query url.Values, body, target any, token string) error {
	var data []byte
	var err error
	if body != nil {
		data, err = json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode marketplace request: %w", err)
		}
		if len(data) > 64<<10 {
			return ErrInvalidRequest
		}
	}
	request, err := http.NewRequestWithContext(ctx, method, apiURL(source, route, query), bytes.NewReader(data))
	if err != nil {
		return &requestError{cause: err}
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := s.client.Do(request)
	if err != nil {
		return &requestError{cause: err}
	}
	defer response.Body.Close()
	data, err = readBounded(response.Body, maxJSONBytes)
	if err != nil {
		return &requestError{cause: err}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return responseError(response.StatusCode, data)
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if target == nil {
		return nil
	}
	if len(data) == 0 || bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return ErrInvalidResponse
	}
	if err = json.Unmarshal(data, target); err != nil {
		return ErrInvalidResponse
	}
	return nil
}

func responseError(status int, data []byte) error {
	var envelope struct {
		Code string `json:"code"`
	}
	code := "http_error"
	if json.Unmarshal(data, &envelope) == nil && codePattern.MatchString(envelope.Code) {
		code = envelope.Code
	}
	return &APIError{StatusCode: status, Code: code}
}

func (s *Service) authenticatedToken(source sourceSnapshot) (string, error) {
	s.mu.Lock()
	authGeneration := s.authGeneration
	err := s.checkSourceLocked(source)
	s.mu.Unlock()
	if err != nil {
		return "", err
	}
	token, err := s.loadToken(source.id)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err = s.checkSourceLocked(source); err != nil {
		return "", err
	}
	if authGeneration != s.authGeneration {
		return "", ErrUnauthenticated
	}
	return token.AccessToken, nil
}
