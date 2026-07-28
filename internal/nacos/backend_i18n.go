package nacos

import (
	"fmt"
	"sync"

	"GoNavi-Wails/shared/i18n"
)

var (
	nacosBackendTextMu        sync.RWMutex
	nacosBackendTextLanguage  = i18n.LanguageZhCN
	nacosBackendTextLocalizer *i18n.Localizer
)

// SetBackendLanguage updates backend i18n language for this package.
func SetBackendLanguage(language i18n.Language) {
	normalized, ok := i18n.NormalizeLanguage(string(language))
	if !ok {
		return
	}

	nacosBackendTextMu.Lock()
	defer nacosBackendTextMu.Unlock()

	nacosBackendTextLanguage = normalized
	if nacosBackendTextLocalizer == nil {
		localizer, err := i18n.NewLocalizer(normalized)
		if err != nil {
			return
		}
		nacosBackendTextLocalizer = localizer
		return
	}
	nacosBackendTextLocalizer.SetLanguage(normalized)
}

func localizedNacosBackendText(key string, params map[string]any) string {
	nacosBackendTextMu.RLock()
	if nacosBackendTextLocalizer != nil {
		text := nacosBackendTextLocalizer.T(key, params)
		nacosBackendTextMu.RUnlock()
		return text
	}
	nacosBackendTextMu.RUnlock()

	nacosBackendTextMu.Lock()
	defer nacosBackendTextMu.Unlock()

	if nacosBackendTextLocalizer == nil {
		localizer, err := i18n.NewLocalizer(nacosBackendTextLanguage)
		if err != nil {
			return key
		}
		nacosBackendTextLocalizer = localizer
	}
	return nacosBackendTextLocalizer.T(key, params)
}

func localizedNacosBackendError(key string, params map[string]any) error {
	return fmt.Errorf("%s", localizedNacosBackendText(key, params))
}
