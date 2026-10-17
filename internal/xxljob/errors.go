package xxljob

import (
	"errors"
	"net/http"
	"strings"
)

// Sentinels the app binding layer classifies with errors.Is. Each concrete
// error type below implements Is so wrapped instances keep matching.
var (
	// ErrSessionExpired means the admin no longer accepts the current session
	// and a fresh login did not restore it.
	ErrSessionExpired = errors.New("xxljob session expired")
	// ErrVersionProbe means neither the redirect target nor the page shape
	// identified a known protocol stack.
	ErrVersionProbe = errors.New("xxljob version probe failed")
	// ErrExecutorForward means the admin accepted the call but failed to reach
	// the executor it proxies to (log detail / log kill).
	ErrExecutorForward = errors.New("xxljob executor forward failed")
	// ErrRemote means the admin answered with a non-200 business code.
	ErrRemote = errors.New("xxljob remote error")
	// ErrValidation means caller-supplied arguments were rejected before any
	// HTTP traffic was produced.
	ErrValidation = errors.New("xxljob validation failed")
	// ErrNetwork means the admin could not be reached at all.
	ErrNetwork = errors.New("xxljob network failure")
)

// SessionExpiredError reports a login that the admin rejected, in either of the
// two shapes XXL-JOB uses (2.x HTTP 302, 3.2+ HTTP 200 with code 500).
type SessionExpiredError struct {
	Cause error
}

func (e *SessionExpiredError) Error() string {
	return localizedXxlJobText("xxljob.backend.error.session_expired", nil)
}

func (e *SessionExpiredError) Unwrap() error {
	if e == nil {
		return nil
	}
	return ErrSessionExpired
}

func (e *SessionExpiredError) Is(target error) bool { return target == ErrSessionExpired }

// VersionProbeError carries the observations that failed to identify a stack so
// the app layer can show a diagnosable message instead of "unknown".
type VersionProbeError struct {
	Location string
	Detail   string
}

func (e *VersionProbeError) Error() string {
	params := map[string]any{}
	if e != nil && strings.TrimSpace(e.Location) != "" {
		params["location"] = e.Location
	}
	if e != nil && strings.TrimSpace(e.Detail) != "" {
		params["detail"] = e.Detail
	}
	return localizedXxlJobText("xxljob.backend.error.version_probe_failed", params)
}

func (e *VersionProbeError) Unwrap() error {
	if e == nil {
		return nil
	}
	return ErrVersionProbe
}

func (e *VersionProbeError) Is(target error) bool { return target == ErrVersionProbe }

// ExecutorForwardError means admin -> executor proxying failed. The admin stays
// reachable; the executor behind it does not answer.
type ExecutorForwardError struct {
	Detail string
}

func (e *ExecutorForwardError) Error() string {
	params := map[string]any{}
	if e != nil && strings.TrimSpace(e.Detail) != "" {
		params["detail"] = e.Detail
	}
	return localizedXxlJobText("xxljob.backend.error.executor_forward_failed", params)
}

func (e *ExecutorForwardError) Unwrap() error {
	if e == nil {
		return nil
	}
	return ErrExecutorForward
}

func (e *ExecutorForwardError) Is(target error) bool { return target == ErrExecutorForward }

// RemoteError is an admin-side business failure (envelope code != 200).
type RemoteError struct {
	Code int
	Msg  string
}

func (e *RemoteError) Error() string {
	code := 0
	msg := ""
	if e != nil {
		code = e.Code
		msg = redactDiagnosticText(e.Msg)
	}
	return localizedXxlJobText("xxljob.backend.error.remote_code", map[string]any{
		"code": code,
		"msg":  msg,
	})
}

func (e *RemoteError) Unwrap() error {
	if e == nil {
		return nil
	}
	return ErrRemote
}

func (e *RemoteError) Is(target error) bool { return target == ErrRemote }

// ValidationError rejects caller input without touching the network.
type ValidationError struct {
	Field  string
	Detail string
}

func (e *ValidationError) Error() string {
	params := map[string]any{}
	if e != nil && strings.TrimSpace(e.Field) != "" {
		params["field"] = e.Field
	}
	if e != nil && strings.TrimSpace(e.Detail) != "" {
		params["detail"] = e.Detail
	}
	return localizedXxlJobText("xxljob.backend.error.validation", params)
}

func (e *ValidationError) Unwrap() error {
	if e == nil {
		return nil
	}
	return ErrValidation
}

func (e *ValidationError) Is(target error) bool { return target == ErrValidation }

// NetworkError means the admin was unreachable at the transport level.
type NetworkError struct {
	Cause error
}

func (e *NetworkError) Error() string {
	return localizedXxlJobText("xxljob.backend.error.network", nil)
}

func (e *NetworkError) Unwrap() error {
	if e == nil {
		return nil
	}
	return ErrNetwork
}

func (e *NetworkError) Is(target error) bool { return target == ErrNetwork }

func newValidationError(field, detail string) error {
	return &ValidationError{Field: field, Detail: detail}
}

// HTTPStatusError reports a transport-level status that is neither a redirect
// nor a JSON envelope (proxies, gateways, container error pages).
type HTTPStatusError struct {
	Status int
	Body   string
}

func (e *HTTPStatusError) Error() string {
	status := 0
	body := ""
	if e != nil {
		status = e.Status
		body = redactDiagnosticText(e.Body)
	}
	return localizedXxlJobText("xxljob.backend.error.http_status", map[string]any{
		"status": status,
		"body":   body,
	})
}

func (e *HTTPStatusError) Unwrap() error {
	if e == nil {
		return nil
	}
	return &NetworkError{}
}

// isRedirectStatus reports whether the status is one Go's client surfaces when
// redirects are disabled, which is how XXL-JOB signals an expired 2.x session.
func isRedirectStatus(status int) bool {
	switch status {
	case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther,
		http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
		return true
	default:
		return false
	}
}

// sessionExpiredFromRedirect recognizes the 2.x login redirect. The Location
// keeps the admin context-path, so the match is on the path suffix rather than
// the full value.
func sessionExpiredFromRedirect(location string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(location))
	if trimmed == "" {
		return false
	}
	// The admin appends a return target to the login redirect, so compare the
	// path only.
	if cut := strings.IndexAny(trimmed, "?#"); cut >= 0 {
		trimmed = trimmed[:cut]
	}
	for _, suffix := range []string{"/tologin", "/auth/login", "/login"} {
		if strings.HasSuffix(trimmed, suffix) {
			return true
		}
	}
	return false
}

// sessionExpiredFromEnvelope recognizes the 3.2+ SSO rejection: HTTP 200 with a
// 500 code whose message marks it as an auth problem. A plain 500 business
// error (for example "job group not found") must NOT be treated as an expired
// session, otherwise the client would retry every business error forever.
func sessionExpiredFromEnvelope(code int, msg string) bool {
	if code != http.StatusInternalServerError {
		return false
	}
	lowered := strings.ToLower(redactDiagnosticText(msg))
	markers := []string{
		"not login",
		"no login",
		"please login",
		"not logged in",
		"xxlssoexception",
		"invalid login token",
		"login token",
		"unauthorized",
		"未登录",
	}
	for _, marker := range markers {
		if strings.Contains(lowered, marker) {
			return true
		}
	}
	return false
}

func remoteError(code int, msg string) error {
	return &RemoteError{Code: code, Msg: msg}
}

func wrapNetworkError(cause error) error {
	if cause == nil {
		return &NetworkError{}
	}
	return &NetworkError{Cause: cause}
}
