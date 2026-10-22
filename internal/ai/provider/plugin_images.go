package provider

import (
	"encoding/base64"
	"strings"

	"GoNavi-Wails/internal/ai"
)

// Bounded image content parts for plugin providers. The host only forwards
// self-contained base64 data URLs on user messages, so a plugin never receives a
// remote URL that would make the host fetch untrusted resources.
const (
	pluginMaxImagesPerMessage  = 4
	pluginMaxImageDecodedBytes = 4 << 20
	pluginMaxRequestImageBytes = 24 << 20
	pluginImageRequestBytes    = 32 << 20
	pluginTextRequestBytes     = 512 << 10
)

var pluginImageMediaTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/webp": true,
	"image/gif":  true,
}

func pluginRequestBytes(supportsImages bool) int {
	if supportsImages {
		return pluginImageRequestBytes
	}
	return pluginTextRequestBytes
}

func pluginMessageHasImages(messages []ai.Message) bool {
	for _, message := range messages {
		if len(message.Images) > 0 {
			return true
		}
	}
	return false
}

// validatePluginImages accepts only bounded data-URL images on user messages and
// returns the total encoded size. Any unsupported shape is a config error.
func validatePluginImages(messages []ai.Message) (int, error) {
	total := 0
	for _, message := range messages {
		if len(message.Images) == 0 {
			continue
		}
		if message.Role != "user" || len(message.Images) > pluginMaxImagesPerMessage {
			return 0, ErrPluginProviderConfig
		}
		for _, image := range message.Images {
			if !pluginImageDataURL(image) {
				return 0, ErrPluginProviderConfig
			}
			total += len(image)
			if total > pluginMaxRequestImageBytes {
				return 0, ErrPluginProviderConfig
			}
		}
	}
	return total, nil
}

func pluginImageDataURL(value string) bool {
	header, payload, ok := strings.Cut(value, ",")
	if !ok || !strings.HasSuffix(header, ";base64") {
		return false
	}
	mediaType := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	if !strings.HasPrefix(header, "data:") || !pluginImageMediaTypes[mediaType] || payload == "" {
		return false
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(payload)
	if err != nil || len(decoded) == 0 || len(decoded) > pluginMaxImageDecodedBytes {
		return false
	}
	return true
}
