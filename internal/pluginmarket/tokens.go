package pluginmarket

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"GoNavi-Wails/internal/secretstore"
)

type storedToken struct {
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken,omitempty"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

func tokenRef(source string) (string, error) { return secretstore.BuildRef("plugin-market", source) }

func (s *Service) loadToken(source string) (storedToken, error) {
	ref, err := tokenRef(source)
	if err != nil {
		return storedToken{}, err
	}
	payload, err := s.secrets.Get(ref)
	if errors.Is(err, os.ErrNotExist) {
		return storedToken{}, ErrUnauthenticated
	}
	if err != nil {
		return storedToken{}, fmt.Errorf("read marketplace credentials: %w", err)
	}
	var token storedToken
	if len(payload) > 40<<10 || json.Unmarshal(payload, &token) != nil || !validToken(token.AccessToken) {
		return storedToken{}, ErrInvalidResponse
	}
	if !token.ExpiresAt.After(s.now()) {
		return storedToken{}, ErrUnauthenticated
	}
	return token, nil
}

func (s *Service) saveToken(source string, token storedToken) error {
	ref, err := tokenRef(source)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(token)
	if err != nil {
		return fmt.Errorf("encode marketplace credentials: %w", err)
	}
	if err = s.secrets.Put(ref, payload); err != nil {
		return fmt.Errorf("save marketplace credentials: %w", err)
	}
	return nil
}

func (s *Service) deleteToken(source string) error {
	ref, err := tokenRef(source)
	if err != nil {
		return err
	}
	err = s.secrets.Delete(ref)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("delete marketplace credentials: %w", err)
	}
	return nil
}

func validToken(token string) bool {
	if len(token) == 0 || len(token) > 16<<10 {
		return false
	}
	for _, char := range token {
		if char < 33 || char > 126 {
			return false
		}
	}
	return true
}
