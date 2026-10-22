package app

import (
	"bytes"
	"fmt"
	"image/png"
	"os"
	"path/filepath"
	"strings"
)

// preparePersistedWindowsTaskbarArtwork prepares a versioned candidate only for
// a valid selection that needs safe scaling or recovery from rejected v2 frames.
// Large frames keep the full source; small frames keep every design element and
// the original canvas centre. Activation owns the pointer, so preparation never
// changes the previous ICO or commits active-icon.txt.
func preparePersistedWindowsTaskbarArtwork(iconPath, configDir string) (string, error) {
	if strings.HasPrefix(filepath.Base(iconPath), windowsApplicationIconRenderPrefix) {
		return iconPath, nil
	}
	data, err := os.ReadFile(iconPath)
	if err != nil {
		return "", fmt.Errorf("read persisted taskbar artwork: %w", err)
	}
	entries, err := parseWindowsICOEntries(data)
	if err != nil {
		return "", fmt.Errorf("parse persisted taskbar artwork: %w", err)
	}
	hasPNG := false
	for _, entry := range entries {
		if windowsICOPayloadIsPNG(entry.Payload) {
			hasPNG = true
			break
		}
	}
	if !hasPNG {
		return iconPath, nil
	}
	source, err := decodeWindowsICOSourceImageFromEntries(entries)
	if err != nil {
		return "", err
	}
	rejectedV2 := strings.HasPrefix(filepath.Base(iconPath), "gonavi-brand-v2-")
	if _, changed := composeWindowsTaskbarArtwork(source); !changed && !rejectedV2 {
		// Leave normal icons alone, but always rebuild rejected v2 small frames
		// from their unchanged full PNG, even if safe zoom is now 100 percent.
		return iconPath, nil
	}
	var original bytes.Buffer
	if err := png.Encode(&original, source); err != nil {
		return "", fmt.Errorf("encode taskbar migration source: %w", err)
	}
	return persistWindowsApplicationIcon(original.Bytes(), configDir)
}
