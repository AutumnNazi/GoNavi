package market

import (
	"fmt"
	"regexp"
	"slices"
)

const maxArtifactDataSources = 8

var artifactDataSourceIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,63}$`)

// Keep this wire shape independent of the desktop runtime so the service's
// minimal Docker build never needs process supervision or host driver packages.
type artifactDataSource struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Dialect     string `json:"dialect"`
	Command     string `json:"command"`
	DefaultPort int    `json:"defaultPort,omitempty"`
	ReadOnly    bool   `json:"readOnly"`
}

func validateArtifactDataSources(manifest artifactManifest, commands map[string]bool) error {
	sources := manifest.Contributes.DataSources
	if len(sources) == 0 {
		return nil
	}
	if len(sources) > maxArtifactDataSources {
		return fmt.Errorf("too many data source contributions")
	}
	if !slices.Contains(manifest.Permissions, "data.sources") {
		return fmt.Errorf("data source contributions require data.sources permission")
	}
	if manifest.Backend == nil {
		return fmt.Errorf("data source contributions require a backend")
	}
	seen := make(map[string]bool, len(sources))
	for _, source := range sources {
		if !artifactDataSourceIDPattern.MatchString(source.ID) || seen[source.ID] {
			return fmt.Errorf("invalid or duplicate data source id")
		}
		if !artifactText(source.Name, 256) {
			return fmt.Errorf("invalid data source name")
		}
		if source.Dialect != "mysql" && source.Dialect != "postgres" && source.Dialect != "sqlite" {
			return fmt.Errorf("unsupported data source dialect")
		}
		// A missing readOnly field has the same zero value as false and fails closed.
		if !source.ReadOnly {
			return fmt.Errorf("data source contribution must be explicitly read-only")
		}
		if !commands[source.Command] {
			return fmt.Errorf("data source command must name a declared command")
		}
		for _, command := range manifest.Contributes.Commands {
			if command.ID == source.Command && command.Effect != "" && command.Effect != "read" && command.Effect != "unknown" {
				return fmt.Errorf("data source command cannot declare a write effect")
			}
		}
		if source.DefaultPort < 0 || source.DefaultPort > 65535 {
			return fmt.Errorf("data source default port must be between 0 and 65535")
		}
		seen[source.ID] = true
	}
	return nil
}
