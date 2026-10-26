package xxljob

import (
	"regexp"
	"strings"
	"sync"

	"GoNavi-Wails/shared/i18n"
)

// maxDiagnosticTextRunes bounds echoed upstream text so a hostile admin cannot
// flood the UI or the log through an error message.
const maxDiagnosticTextRunes = 200

var (
	xxlJobBackendTextMu        sync.RWMutex
	xxlJobBackendTextLanguage  = i18n.LanguageZhCN
	xxlJobBackendTextLocalizer *i18n.Localizer
)

var (
	// Secret-bearing assignments inside echoed admin text. XXL-JOB never needs
	// these to diagnose a failure, so they are dropped before display.
	xxlJobSecretAssignmentPattern = regexp.MustCompile(
		`(?i)\b(password|passwd|pwd|secret|access[_-]?token|login[_-]?token|identity|authorization)"?\s*[:=]\s*"?[^\s",;}]+"?`,
	)
	// 2.x echoes the login cookie (historically an MD5 of the password) in some
	// error paths; strip any cookie pair that survives into a message.
	xxlJobCookiePattern = regexp.MustCompile(
		`(?i)(XXL_JOB_LOGIN_IDENTITY|xxl_job_login_token|JSESSIONID)\s*=\s*[^;\s]+`,
	)
)

// SetBackendLanguage updates backend i18n language for this package.
func SetBackendLanguage(language i18n.Language) {
	normalized, ok := i18n.NormalizeLanguage(string(language))
	if !ok {
		return
	}

	xxlJobBackendTextMu.Lock()
	defer xxlJobBackendTextMu.Unlock()

	xxlJobBackendTextLanguage = normalized
	if xxlJobBackendTextLocalizer == nil {
		localizer, err := i18n.NewLocalizer(normalized)
		if err != nil {
			return
		}
		xxlJobBackendTextLocalizer = localizer
		return
	}
	xxlJobBackendTextLocalizer.SetLanguage(normalized)
}

func localizedXxlJobText(key string, params map[string]any) string {
	params = sanitizeXxlJobDiagnosticParams(params)

	xxlJobBackendTextMu.RLock()
	if xxlJobBackendTextLocalizer != nil {
		text := xxlJobBackendTextLocalizer.T(key, params)
		xxlJobBackendTextMu.RUnlock()
		return text
	}
	xxlJobBackendTextMu.RUnlock()

	xxlJobBackendTextMu.Lock()
	defer xxlJobBackendTextMu.Unlock()

	if xxlJobBackendTextLocalizer == nil {
		localizer, err := i18n.NewLocalizer(xxlJobBackendTextLanguage)
		if err != nil {
			return key
		}
		xxlJobBackendTextLocalizer = localizer
	}
	return xxlJobBackendTextLocalizer.T(key, params)
}

func sanitizeXxlJobDiagnosticParams(params map[string]any) map[string]any {
	if len(params) == 0 {
		return params
	}
	sanitized := make(map[string]any, len(params))
	for key, value := range params {
		sanitized[key] = value
	}
	for _, key := range []string{"body", "detail", "message", "msg"} {
		if text, ok := sanitized[key].(string); ok {
			sanitized[key] = redactDiagnosticText(text)
		}
	}
	return sanitized
}

// redactDiagnosticText removes secrets and caps length for any upstream text
// that will reach the UI, the log, or a returned error string.
func redactDiagnosticText(text string) string {
	redacted := xxlJobSecretAssignmentPattern.ReplaceAllString(text, "${1}=[REDACTED]")
	redacted = xxlJobCookiePattern.ReplaceAllString(redacted, "${1}=[REDACTED]")
	return truncateDiagnostic(redacted)
}

func truncateDiagnostic(text string) string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) <= maxDiagnosticTextRunes {
		return string(runes)
	}
	return string(runes[:maxDiagnosticTextRunes]) + "..."
}

func localizedXxlJobError(key string, params map[string]any) error {
	return &xxlJobError{message: localizedXxlJobText(key, params)}
}

// localizedXxlJobErrorWithCause keeps the display text localized without
// discarding an underlying error that the app layer needs to classify.
func localizedXxlJobErrorWithCause(key string, params map[string]any, cause error) error {
	if cause == nil {
		return localizedXxlJobError(key, params)
	}
	return &xxlJobError{message: localizedXxlJobText(key, params), cause: cause}
}

type xxlJobError struct {
	message string
	cause   error
}

func (e *xxlJobError) Error() string {
	if e == nil {
		return ""
	}
	return e.message
}

func (e *xxlJobError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}
