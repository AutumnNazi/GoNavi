package plugin

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const maxDataSources = 8
const maxDataSourceTypeBytes = len("plugin:") + 128 + 1 + 64 + 1 + len("postgres")

var dataSourceIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,63}$`)

// ErrDataSourceWriteEffect means a read-only source points at a command that declares effect write.
var ErrDataSourceWriteEffect = errors.New("data source command cannot declare a write effect")

// DataSource declares one SQL-family driver routed through a backend command.
// ReadOnly must be explicit; writable sources opt in to host write and transaction
// dispatch and are still subject to the connection's own protection settings.
type DataSource struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Dialect     string `json:"dialect"`
	Command     string `json:"command"`
	DefaultPort int    `json:"defaultPort,omitempty"`
	ReadOnly    bool   `json:"readOnly"`
}

// DataSourceType returns the canonical namespaced connection type for a valid identity.
// Invalid identities return an empty string. It does not establish runtime availability
// or validate the source's capabilities; callers must match the installed manifest.
func DataSourceType(pluginID string, source DataSource) string {
	if !validPluginID(pluginID) || !dataSourceIDPattern.MatchString(source.ID) || !validDataSourceDialect(source.Dialect) {
		return ""
	}
	return "plugin:" + pluginID + ":" + source.ID + ":" + source.Dialect
}

// ParseDataSourceType parses a canonical identity without trimming, case folding,
// aliasing, or consulting installed plugins. Invalid input returns empty components.
func ParseDataSourceType(value string) (pluginID, sourceID, dialect string, ok bool) {
	if len(value) > maxDataSourceTypeBytes || !strings.HasPrefix(value, "plugin:") {
		return "", "", "", false
	}
	parts := strings.Split(value, ":")
	if len(parts) != 4 || !validPluginID(parts[1]) || !dataSourceIDPattern.MatchString(parts[2]) || !validDataSourceDialect(parts[3]) {
		return "", "", "", false
	}
	return parts[1], parts[2], parts[3], true
}

func validDataSourceDialect(value string) bool {
	return value == "mysql" || value == "postgres" || value == "sqlite"
}

func validateDataSources(manifest Manifest, commands map[string]bool) error {
	sources := manifest.Contributes.DataSources
	if len(sources) == 0 {
		return nil
	}
	if len(sources) > maxDataSources {
		return fmt.Errorf("too many data source contributions")
	}
	permitted := false
	for _, permission := range manifest.Permissions {
		if permission == "data.sources" {
			permitted = true
			break
		}
	}
	if !permitted {
		return fmt.Errorf("data source contributions require data.sources permission")
	}
	if manifest.Backend == nil {
		return fmt.Errorf("data source contributions require a backend")
	}
	ids := make(map[string]bool, len(sources))
	types := make(map[string]bool, len(sources))
	for _, source := range sources {
		identity := DataSourceType(manifest.ID, source)
		if identity == "" || ids[source.ID] || types[identity] {
			return fmt.Errorf("invalid or duplicate data source identity")
		}
		if !validText(source.Name, 256) {
			return fmt.Errorf("invalid data source name")
		}
		if !localIDPattern.MatchString(source.Command) || !commands[source.Command] {
			return fmt.Errorf("data source references an undeclared command")
		}
		if source.ReadOnly {
			for _, command := range manifest.Contributes.Commands {
				if command.ID == source.Command && command.Effect != "" && command.Effect != "read" && command.Effect != "unknown" {
					return ErrDataSourceWriteEffect
				}
			}
		}
		if source.DefaultPort < 0 || source.DefaultPort > 65535 {
			return fmt.Errorf("invalid data source default port")
		}
		ids[source.ID] = true
		types[identity] = true
	}
	return nil
}
