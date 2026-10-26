package plugin

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

const maxExporters = 8
const maxExporterTypeBytes = len("plugin:") + 128 + 1 + 64
const maxExporterJSONBytes = 512 << 10

var exporterIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,63}$`)
var exporterExtensionPattern = regexp.MustCompile(`^[a-z0-9]{1,16}$`)
var exporterContentTypePattern = regexp.MustCompile(`^(text|application)/[a-z0-9][a-z0-9.+-]{0,63}$`)

// Exporter declares a bounded snapshot renderer; its metadata grants no filesystem access.
type Exporter struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Command     string `json:"command"`
	Extension   string `json:"extension"`
	ContentType string `json:"contentType"`
	// Streaming lets the host render a large selection in bounded, ordered chunks.
	Streaming bool `json:"streaming,omitempty"`
}

// ExporterType returns a canonical format identity, not execution authority.
func ExporterType(pluginID string, exporter Exporter) string {
	if !validPluginID(pluginID) || !exporterIDPattern.MatchString(exporter.ID) {
		return ""
	}
	return "plugin:" + pluginID + ":" + exporter.ID
}

// ParseExporterType accepts exact identities without trimming or case repair.
func ParseExporterType(value string) (pluginID, exporterID string, ok bool) {
	if len(value) > maxExporterTypeBytes || !strings.HasPrefix(value, "plugin:") {
		return "", "", false
	}
	parts := strings.Split(value, ":")
	if len(parts) != 3 || !validPluginID(parts[1]) || !exporterIDPattern.MatchString(parts[2]) {
		return "", "", false
	}
	return parts[1], parts[2], true
}

// IsExporterNamespace reserves malformed plugin-like input before builtin normalization.
// It detects bare/case/whitespace variants but never repairs them into valid identities.
func IsExporterNamespace(value string) bool {
	head, _, _ := strings.Cut(strings.TrimSpace(value), ":")
	return strings.EqualFold(strings.TrimSpace(head), "plugin")
}

func validateExporters(manifest Manifest, commands map[string]bool) error {
	if len(manifest.Contributes.Exporters) == 0 {
		return nil
	}
	if len(manifest.Contributes.Exporters) > maxExporters {
		return fmt.Errorf("too many exporter contributions")
	}
	if manifest.Backend == nil || !hasExporterPermission(manifest) {
		return fmt.Errorf("exporters require data.export permission and backend")
	}
	ids := make(map[string]bool, len(manifest.Contributes.Exporters))
	for _, exporter := range manifest.Contributes.Exporters {
		if ExporterType(manifest.ID, exporter) == "" || ids[exporter.ID] {
			return fmt.Errorf("invalid or duplicate exporter identity")
		}
		if !utf8.ValidString(exporter.Name) || !validText(exporter.Name, 256) || !commands[exporter.Command] {
			return fmt.Errorf("invalid exporter name or undeclared command")
		}
		if !exporterExtensionPattern.MatchString(exporter.Extension) || !exporterContentTypePattern.MatchString(exporter.ContentType) {
			return fmt.Errorf("invalid exporter extension or content type")
		}
		ids[exporter.ID] = true
	}
	return nil
}

func hasExporterPermission(manifest Manifest) bool {
	for _, permission := range manifest.Permissions {
		if permission == "data.export" {
			return true
		}
	}
	return false
}

func exporterCommandReserved(manifest Manifest, command string) bool {
	for _, exporter := range manifest.Contributes.Exporters {
		if exporter.Command == command {
			return true
		}
	}
	return false
}
