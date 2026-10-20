package backgroundgallery

import (
	"bytes"
	"encoding/json"
	"io"
	"net/url"
	"regexp"
	"strings"
)

const (
	maxCatalogBytes     = 2 << 20
	maxImageBytes       = 16 << 20
	maxThumbnailBytes   = 256 << 10
	maxPixels           = 24000000
	maxInstalledBytes   = 16 << 20
	maxInstalledEntries = 256
)

var (
	idPattern      = regexp.MustCompile("^[a-z0-9][a-z0-9-]{0,63}$")
	versionPattern = regexp.MustCompile("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
	hashPattern    = regexp.MustCompile("^[a-f0-9]{64}$")
)

func validText(text string, max int) bool {
	return strings.TrimSpace(text) != "" && len(text) <= max && !strings.ContainsRune(text, 0)
}
func validReference(text string) bool {
	u, err := url.Parse(text)
	return err == nil && len(text) <= 2048 && u.Scheme == "https" && u.Hostname() != "" && u.User == nil
}
func validIdentity(id, version string, optionalVersion bool) bool {
	return idPattern.MatchString(id) && (versionPattern.MatchString(version) || optionalVersion && version == "")
}
func validateAsset(a Asset, limit int64) error {
	ext := ""
	switch a.MIMEType {
	case "image/png":
		ext = "png"
	case "image/jpeg":
		ext = "jpg"
	case "image/webp":
		ext = "webp"
	default:
		return failure("invalid_catalog", "unsupported image mime")
	}
	if !hashPattern.MatchString(a.SHA256) || a.Path != "assets/"+a.SHA256+"."+ext {
		return failure("invalid_catalog", "invalid content addressed path")
	}
	if a.SizeBytes < 1 || a.SizeBytes > limit || a.Width < 1 || a.Height < 1 || a.Width > maxPixels || a.Height > maxPixels || int64(a.Width)*int64(a.Height) > maxPixels {
		return failure("invalid_catalog", "invalid image bounds")
	}
	return nil
}
func validateEntry(e Entry) error {
	if !validIdentity(e.ID, e.Version, false) || (e.Fit != "contain" && e.Fit != "cover") || e.RightsStatus != "approved" {
		return failure("invalid_catalog", "invalid entry identity or rights")
	}
	if len(e.Names) < 1 || len(e.Names) > 16 {
		return failure("invalid_catalog", "invalid localized names")
	}
	for language, name := range e.Names {
		if !validText(language, 32) || !validText(name, 256) {
			return failure("invalid_catalog", "invalid localized name")
		}
	}
	l := e.License
	if !validText(e.Attribution, 8192) || !validReference(e.SourceURL) || !validText(l.ID, 128) || !validText(l.Name, 256) || !validReference(l.URL) || !validText(l.Notice, 16384) || !validText(l.Text, 65536) {
		return failure("invalid_catalog", "missing or oversized rights record")
	}
	if err := validateAsset(e.Image, maxImageBytes); err != nil {
		return err
	}
	return validateAsset(e.Thumbnail, maxThumbnailBytes)
}
func decodeJSON(payload []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return failure("invalid_catalog", "trailing json content")
	}
	return nil
}
func parseCatalog(payload []byte) (*Catalog, error) {
	if len(payload) > maxCatalogBytes {
		return nil, failure("invalid_catalog", "catalog exceeds byte limit")
	}
	var catalog Catalog
	if err := decodeJSON(payload, &catalog); err != nil {
		return nil, wrap("invalid_catalog", err)
	}
	if catalog.SchemaVersion != 1 || !versionPattern.MatchString(catalog.Version) || catalog.Entries == nil || len(catalog.Entries) > 64 {
		return nil, failure("invalid_catalog", "invalid catalog header")
	}
	seen := make(map[string]bool, len(catalog.Entries))
	for _, entry := range catalog.Entries {
		if seen[entry.ID] {
			return nil, failure("invalid_catalog", "duplicate entry id")
		}
		seen[entry.ID] = true
		if err := validateEntry(entry); err != nil {
			return nil, err
		}
	}
	return &catalog, nil
}
