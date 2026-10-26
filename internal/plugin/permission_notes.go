package plugin

import (
	"fmt"
	"strings"
	"unicode"
)

func validatePermissionNotes(m Manifest, granted map[string]bool) error {
	if len(m.PermissionNotes) == 0 {
		return nil
	}
	if len(m.PermissionNotes) > len(granted) {
		return fmt.Errorf("permission note does not match a declared permission")
	}
	for key, note := range m.PermissionNotes {
		if !granted[key] || !validPermissionNote(note) {
			return fmt.Errorf("invalid permission note")
		}
	}
	return nil
}

func validPermissionNote(note string) bool {
	if !validText(note, 160) || strings.ContainsAny(note, "<>") {
		return false
	}
	for _, r := range note {
		if r < 0x20 || r == 0x7f || unicode.Is(unicode.Cc, r) {
			return false
		}
	}
	return true
}
