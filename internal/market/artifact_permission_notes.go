package market

import (
	"fmt"
	"strings"
	"unicode"
)

func validateArtifactPermissionNotes(manifest artifactManifest, granted map[string]bool) error {
	if len(manifest.PermissionNotes) == 0 {
		return nil
	}
	if len(manifest.PermissionNotes) > len(granted) {
		return fmt.Errorf("permission note does not match a declared permission")
	}
	for key, note := range manifest.PermissionNotes {
		if !granted[key] || !validArtifactPermissionNote(note) {
			return fmt.Errorf("invalid permission note")
		}
	}
	return nil
}

func validArtifactPermissionNote(note string) bool {
	if !artifactText(note, 160) || strings.ContainsAny(note, "<>") {
		return false
	}
	for _, r := range note {
		if r < 0x20 || r == 0x7f || unicode.Is(unicode.Cc, r) {
			return false
		}
	}
	return true
}
