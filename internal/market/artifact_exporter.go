package market

import (
	"fmt"
	"regexp"
	"slices"
)

const maxArtifactExporters = 8

var (
	artifactExporterIDPattern          = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,63}$`)
	artifactExporterExtensionPattern   = regexp.MustCompile(`^[a-z0-9]{1,16}$`)
	artifactExporterContentTypePattern = regexp.MustCompile(`^(text|application)/[a-z0-9][a-z0-9.+-]{0,63}$`)
)

// artifactExporter is publication metadata, independent of runtime or renderer code.
type artifactExporter struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Command     string `json:"command"`
	Extension   string `json:"extension"`
	ContentType string `json:"contentType"`
	Streaming   bool   `json:"streaming,omitempty"`
}

func validateArtifactExporters(manifest artifactManifest, commands map[string]bool) error {
	exporters := manifest.Contributes.Exporters
	if len(exporters) == 0 {
		return nil
	}
	if len(exporters) > maxArtifactExporters {
		return fmt.Errorf("too many exporter contributions")
	}
	if !slices.Contains(manifest.Permissions, "data.export") {
		return fmt.Errorf("exporter contributions require data.export permission")
	}
	if manifest.Backend == nil {
		return fmt.Errorf("exporter contributions require a backend")
	}
	seen := make(map[string]bool, len(exporters))
	for _, exporter := range exporters {
		if !artifactExporterIDPattern.MatchString(exporter.ID) || seen[exporter.ID] {
			return fmt.Errorf("invalid or duplicate exporter id")
		}
		if !artifactText(exporter.Name, 256) {
			return fmt.Errorf("invalid exporter name")
		}
		if !commands[exporter.Command] {
			return fmt.Errorf("exporter command must name a declared command")
		}
		if !artifactExporterExtensionPattern.MatchString(exporter.Extension) {
			return fmt.Errorf("invalid exporter extension")
		}
		if !artifactExporterContentTypePattern.MatchString(exporter.ContentType) {
			return fmt.Errorf("invalid exporter content type")
		}
		seen[exporter.ID] = true
	}
	return nil
}
