package market

import (
	"html/template"
	"net/http"

	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/shared/i18n"

	"golang.org/x/text/language"
)

const deviceHTML = `<!doctype html><html lang="{{.Language}}"><meta charset="utf-8">
<title>{{.Text.login_title}}</title><h1>{{.Text.login_title}}</h1><p>{{.Text.safety}}</p>
<form action="/api/v1/auth/github" method="get"><label>{{.Text.device_code}}
<input name="user_code" required maxlength="11" autocomplete="off" pattern="[A-Fa-f0-9]{5}-[A-Fa-f0-9]{5}"></label>
<button type="submit">{{.Text.continue_github}}</button></form></html>`

const consentHTML = `<!doctype html><html lang="{{.Language}}"><meta charset="utf-8">
<title>{{.Text.consent_title}}</title><h1>{{.Text.consent_title}}</h1>
<p>{{.Text.signed_in}} <strong>{{.Login}}</strong></p><p>{{.Text.confirm_code}} <strong>{{.Code}}</strong></p>
<p>{{.Text.permissions_notice}}</p><form method="post" action="/api/v1/auth/device/decision">
<input type="hidden" name="nonce" value="{{.Nonce}}"><button name="decision" value="approve">{{.Text.authorize}}</button>
<button name="decision" value="deny">{{.Text.deny}}</button></form></html>`

const decisionHTML = `<!doctype html><html lang="{{.Language}}"><meta charset="utf-8">
<title>{{.Text.consent_title}}</title><h1>{{.Decision}}</h1><p>{{.Text.return}}</p></html>`

type authPageData struct {
	Language                     string
	Text                         map[string]string
	Login, Code, Nonce, Decision string
}

func authLanguage(r *http.Request) i18n.Language {
	raw := r.Header.Get("Accept-Language")
	if len(raw) > 1024 {
		return i18n.LanguageEnUS
	}
	accepted, _, err := language.ParseAcceptLanguage(raw)
	if err != nil {
		return i18n.LanguageEnUS
	}
	tags := []language.Tag{language.AmericanEnglish, language.SimplifiedChinese, language.TraditionalChinese, language.Japanese, language.German, language.Russian}
	locales := []i18n.Language{i18n.LanguageEnUS, i18n.LanguageZhCN, i18n.LanguageZhTW, i18n.LanguageJaJP, i18n.LanguageDeDE, i18n.LanguageRuRU}
	_, index, _ := language.NewMatcher(tags).Match(accepted...)
	return locales[index]
}

func (s *Server) renderAuthPage(w http.ResponseWriter, r *http.Request, body string, view authPageData) {
	// Copy only request-local language selection; the shared catalog maps remain read-only.
	localizer := *s.localizer
	localizer.SetLanguage(authLanguage(r))
	view.Language = string(localizer.Language())
	keys := []string{"login_title", "safety", "device_code", "continue_github", "consent_title", "signed_in", "confirm_code", "permissions_notice", "authorize", "deny", "authorized", "denied", "return"}
	view.Text = make(map[string]string, len(keys))
	for _, key := range keys {
		view.Text[key] = localizer.T("plugin.market.web."+key, nil)
	}
	if view.Decision != "" {
		view.Decision = view.Text[view.Decision]
	}
	page, err := template.New("auth").Parse(body)
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err = page.Execute(w, view); err != nil {
		logger.Warnf("market auth page response interrupted")
	}
}
