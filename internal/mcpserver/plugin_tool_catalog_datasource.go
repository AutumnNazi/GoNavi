package mcpserver

import "GoNavi-Wails/internal/plugin"

func pluginHasPublicCommands(manifest plugin.Manifest) bool {
	reserved := pluginReservedCommands(manifest)
	for _, command := range manifest.Contributes.Commands {
		if !reserved[command.ID] {
			return true
		}
	}
	return false
}

func pluginReservedCommands(manifest plugin.Manifest) map[string]bool {
	// Reservations follow declarations even if a malformed snapshot lacks the
	// associated permission. ai.tools never grants provider or driver access.
	reserved := make(map[string]bool, len(manifest.Contributes.DataSources)+len(manifest.Contributes.AIProviders)+len(manifest.Contributes.Exporters))
	for _, source := range manifest.Contributes.DataSources {
		reserved[source.Command] = true
	}
	for _, declaration := range manifest.Contributes.AIProviders {
		reserved[declaration.Command] = true
	}
	for _, exporter := range manifest.Contributes.Exporters {
		reserved[exporter.Command] = true
	}
	return reserved
}
