package market

import "encoding/json"

func categoryFromManifest(raw json.RawMessage) string {
	var manifest struct {
		Contributes map[string]json.RawMessage
		Window      json.RawMessage
	}
	if json.Unmarshal(raw, &manifest) != nil {
		return "other"
	}
	has := func(name string) bool {
		var entries []json.RawMessage
		return json.Unmarshal(manifest.Contributes[name], &entries) == nil && len(entries) > 0
	}
	switch {
	case has("dataSources"):
		return "datasource"
	case has("aiProviders"):
		return "ai-provider"
	case has("exporters"):
		return "exporter"
	case has("panels") && has("commands"):
		return "ops"
	case has("panels"):
		return "panel"
	case has("skills"):
		return "skill"
	case has("commands"):
		return "command"
	case len(manifest.Window) > 0 && string(manifest.Window) != "null":
		return "panel"
	default:
		return "other"
	}
}

func normalizeCatalogCategory(value string) (string, error) {
	aliases := map[string]string{"全部": "", "数据源": "datasource", "AI 供应商": "ai-provider", "导出器": "exporter", "技能": "skill", "面板": "panel", "命令": "command", "运维": "ops", "其他": "other"}
	if normalized, ok := aliases[value]; ok {
		return normalized, nil
	}
	if validCatalogCategory(value) {
		return value, nil
	}
	return "", ErrInvalid
}

func validCatalogCategory(value string) bool {
	switch value {
	case "", "datasource", "ai-provider", "exporter", "skill", "panel", "command", "ops", "other":
		return true
	default:
		return false
	}
}
