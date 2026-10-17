package xxljob

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

// loginCredentialMarkers identify an authentication rejection, as opposed to a
// route that simply does not exist on this version.
var loginCredentialMarkers = []string{
	"user/password",
	"user password",
	"password error",
	"密码",
	"账号",
}

func (c *Client) isLoggedIn() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.loggedIn
}

func (c *Client) invalidateSession() {
	c.mu.Lock()
	c.loggedIn = false
	c.mu.Unlock()
}

func (c *Client) setLoggedIn(loggedIn bool) {
	c.mu.Lock()
	c.loggedIn = loggedIn
	c.mu.Unlock()
}

// ensureLoggedIn logs in once per session. Concurrent callers share a single
// in-flight attempt so a panel that loads several tables at once does not open
// three sessions.
func (c *Client) ensureLoggedIn(ctx context.Context) error {
	if c.isLoggedIn() {
		return nil
	}
	c.mu.Lock()
	group := c.loginGroup
	c.mu.Unlock()
	if group == nil {
		return localizedXxlJobError("xxljob.backend.error.not_connected", nil)
	}

	_, err, _ := group.Do("", func() (any, error) {
		if c.isLoggedIn() {
			return nil, nil
		}
		return nil, c.performLogin(ctx)
	})
	return err
}

// performLogin tries the detected authentication family first. When the admin
// answers that the route is missing, it retries with the other family so a
// deployment whose root redirect is customized still connects instead of
// failing with an opaque 404.
func (c *Client) performLogin(ctx context.Context) error {
	stack := c.stackSnapshot()
	candidates := []LoginFamily{stack.Login}
	if stack.Login == LoginSSO {
		candidates = append(candidates, LoginLegacy)
	} else {
		candidates = append(candidates, LoginSSO)
	}

	var lastErr error
	for _, family := range candidates {
		err := c.tryLogin(ctx, family)
		if err == nil {
			c.mu.Lock()
			c.stack.Login = family
			c.loggedIn = true
			c.mu.Unlock()
			return nil
		}
		lastErr = err
		if errors.Is(err, ErrSessionExpired) {
			// The route exists and rejected the credentials; trying the other
			// family would only resend the password to a missing endpoint.
			return err
		}
		var statusErr *HTTPStatusError
		if errors.As(err, &statusErr) &&
			(statusErr.Status == http.StatusNotFound || statusErr.Status == http.StatusMethodNotAllowed) {
			continue
		}
		return err
	}
	return lastErr
}

func (c *Client) tryLogin(ctx context.Context, family LoginFamily) error {
	c.mu.Lock()
	config := c.config
	stack := c.stack
	c.mu.Unlock()

	values := url.Values{}
	values.Set("userName", config.User)
	values.Set("password", config.Password)
	// Asking the admin to remember the session keeps the cookie alive for the
	// whole working session instead of expiring with the browser.
	values.Set("ifRemember", "on")

	probe := stack
	probe.Login = family

	requestCtx, cancel := c.requestTimeout(ctx)
	defer cancel()
	raw, err := c.do(requestCtx, http.MethodPost, probe.loginRoute(), values, nil)
	if err != nil {
		return err
	}
	if isRedirectStatus(raw.status) {
		if sessionExpiredFromRedirect(raw.location) {
			return &SessionExpiredError{}
		}
		return &HTTPStatusError{Status: raw.status, Body: raw.location}
	}
	if raw.status != http.StatusOK {
		return &HTTPStatusError{Status: raw.status, Body: string(raw.body)}
	}
	envelope, decodeErr := decodeEnvelope(raw.body)
	if decodeErr != nil {
		return localizedXxlJobErrorWithCause("xxljob.backend.error.invalid_response", nil, decodeErr)
	}
	if envelope.succeeded() {
		return nil
	}
	message := envelope.text()
	if isCredentialRejection(message) {
		return &SessionExpiredError{Cause: errors.New(redactDiagnosticText(message))}
	}
	if sessionExpiredFromEnvelope(envelope.code(), message) {
		return &SessionExpiredError{}
	}
	return remoteError(envelope.code(), message)
}

func isCredentialRejection(message string) bool {
	lowered := strings.ToLower(redactDiagnosticText(message))
	if lowered == "" {
		return false
	}
	for _, marker := range loginCredentialMarkers {
		if strings.Contains(lowered, strings.ToLower(marker)) {
			return true
		}
	}
	return false
}

// Logout ends the admin session. Failures are non-fatal: the local session is
// dropped either way.
func (c *Client) Logout(ctx context.Context) error {
	if !c.isLoggedIn() {
		return nil
	}
	c.mu.Lock()
	stack := c.stack
	c.mu.Unlock()

	_, err := c.do(ctx, http.MethodPost, stack.logoutRoute(), nil, nil)
	c.invalidateSession()
	return err
}
