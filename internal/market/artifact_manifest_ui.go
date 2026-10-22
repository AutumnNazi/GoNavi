package market

import (
	"fmt"
)

func validateArtifactContributions(manifest artifactManifest) error {
	contributions := manifest.Contributes
	if len(contributions.Commands) > 128 || len(contributions.Panels) > 32 {
		return fmt.Errorf("too many commands or panels")
	}
	if len(contributions.Commands) > 0 && manifest.Backend == nil {
		return fmt.Errorf("commands require a backend")
	}
	commands := make(map[string]bool, len(contributions.Commands))
	for _, command := range contributions.Commands {
		if !artifactLocalIDPattern.MatchString(command.ID) || commands[command.ID] || !artifactText(command.Title, 256) || !artifactOptionalText(command.Description, 4096) {
			return fmt.Errorf("invalid or duplicate command")
		}
		if command.Effect != "" && command.Effect != "read" && command.Effect != "write" && command.Effect != "unknown" {
			return fmt.Errorf("unsupported command effect")
		}
		if err := validateArtifactSchema(command.InputSchema); err != nil {
			return err
		}
		commands[command.ID] = true
	}
	panels := make(map[string]bool, len(contributions.Panels))
	nodes := 0
	for _, panel := range contributions.Panels {
		if !artifactLocalIDPattern.MatchString(panel.ID) || panels[panel.ID] || !artifactText(panel.Title, 256) {
			return fmt.Errorf("invalid or duplicate panel")
		}
		panels[panel.ID] = true
		if err := validateArtifactNode(panel.Body, commands, 0, &nodes); err != nil {
			return err
		}
	}
	if err := validateArtifactDataSources(manifest, commands); err != nil {
		return err
	}
	if err := validateArtifactAIProviders(manifest, commands); err != nil {
		return err
	}
	return validateArtifactExporters(manifest, commands)
}

func validateArtifactNode(node artifactUINode, commands map[string]bool, depth int, count *int) error {
	*count++
	if depth > 16 || *count > 512 {
		return fmt.Errorf("panel tree exceeds nesting or node limit")
	}
	if !artifactOptionalText(node.Text, 16384) || !artifactOptionalText(node.Title, 1024) || len(node.Arguments) > 64<<10 {
		return fmt.Errorf("panel text or arguments exceed limit")
	}
	switch node.Type {
	case "text", "alert", "column", "row", "button", "table":
	default:
		return fmt.Errorf("unsupported panel element")
	}
	if (node.Type == "button" && !commands[node.Command]) || (node.Type != "button" && node.Command != "") {
		return fmt.Errorf("invalid panel command reference")
	}
	if len(node.Columns) > 32 || len(node.Rows) > 500 || len(node.Children) > 128 {
		return fmt.Errorf("panel data exceeds limit")
	}
	columns := make(map[string]bool, len(node.Columns))
	for _, column := range node.Columns {
		if !artifactText(column.Key, 128) || !artifactText(column.Title, 256) || columns[column.Key] {
			return fmt.Errorf("invalid or duplicate panel column")
		}
		columns[column.Key] = true
	}
	dataBytes := 0
	for _, row := range node.Rows {
		if len(row) > 32 {
			return fmt.Errorf("panel row exceeds limit")
		}
		for key, value := range row {
			if !columns[key] {
				return fmt.Errorf("panel cell references undeclared column")
			}
			dataBytes += len(key) + len(value)
		}
	}
	if dataBytes > 256<<10 {
		return fmt.Errorf("panel table exceeds byte limit")
	}
	for _, child := range node.Children {
		if err := validateArtifactNode(child, commands, depth+1, count); err != nil {
			return err
		}
	}
	return nil
}
