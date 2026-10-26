package market

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var (
	artifactIDSegmentPattern  = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
	artifactLocalIDPattern    = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`)
	artifactPermissionPattern = regexp.MustCompile(`^[a-z][a-z0-9._:-]{0,127}$`)
	artifactPlatformPattern   = regexp.MustCompile(`^(windows|linux|darwin)/(amd64|arm64|386|arm)$`)
	artifactVersionPattern    = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$`)
)

func (index *artifactIndex) validateManifest(ctx context.Context) (ValidatedPackage, error) {
	if err := ctx.Err(); err != nil {
		return ValidatedPackage{}, err
	}
	manifest, err := decodeArtifactManifest(index.manifest)
	if err != nil {
		return ValidatedPackage{}, err
	}
	if err := validateArtifactMetadata(manifest); err != nil {
		return ValidatedPackage{}, err
	}
	platforms, err := index.validateBackend(manifest.Backend)
	if err != nil {
		return ValidatedPackage{}, err
	}
	if err := validateArtifactContributions(manifest); err != nil {
		return ValidatedPackage{}, err
	}
	if err := index.validateSkillContributions(manifest); err != nil {
		return ValidatedPackage{}, err
	}
	if window := manifest.Window; window != nil {
		if err := index.reference(window.Entry); err != nil {
			return ValidatedPackage{}, fmt.Errorf("window entry: %w", err)
		}
		if !artifactOptionalText(window.Title, 256) || window.Width < 0 || window.Height < 0 || window.Width > 8192 || window.Height > 8192 {
			return ValidatedPackage{}, fmt.Errorf("invalid window title or dimensions")
		}
	}
	for _, provider := range manifest.Contributes.AIProviders {
		if provider.Icon != "" {
			if err := index.reference(provider.Icon); err != nil {
				return ValidatedPackage{}, fmt.Errorf("ai provider icon: %w", err)
			}
		}
	}
	if err := validateArtifactSchema(manifest.ConfigSchema); err != nil {
		return ValidatedPackage{}, err
	}
	if err := ctx.Err(); err != nil {
		return ValidatedPackage{}, err
	}
	return ValidatedPackage{
		Manifest: bytes.Clone(index.manifest), ID: manifest.ID, Name: manifest.Name,
		Version: manifest.Version, Description: manifest.Description, Author: manifest.Author,
		MinHostVersion: manifest.MinHostVersion, Platforms: platforms,
	}, nil
}

func validateArtifactMetadata(manifest artifactManifest) error {
	if manifest.SchemaVersion != 1 || manifest.APIVersion != 1 {
		return fmt.Errorf("unsupported manifest schema or api version")
	}
	if !validArtifactID(manifest.ID) || !artifactText(manifest.Name, 256) || !validArtifactVersion(manifest.Version) {
		return fmt.Errorf("invalid manifest id, name, or version")
	}
	if !artifactOptionalText(manifest.Description, 16384) || !artifactOptionalText(manifest.Author, 512) || !artifactOptionalText(manifest.License, 256) {
		return fmt.Errorf("invalid or oversized manifest metadata")
	}
	if manifest.MinHostVersion != "" && !validArtifactVersion(manifest.MinHostVersion) {
		return fmt.Errorf("invalid minimum host version")
	}
	if manifest.Permissions == nil || len(manifest.Permissions) > 64 || len(manifest.Requires) > 64 {
		return fmt.Errorf("permissions array is required; at most 64 permissions or dependencies")
	}
	permissions := make(map[string]bool, len(manifest.Permissions))
	for _, permission := range manifest.Permissions {
		if !artifactPermissionPattern.MatchString(permission) || permissions[permission] {
			return fmt.Errorf("invalid or duplicate permission")
		}
		permissions[permission] = true
	}
	if err := validateArtifactPermissionNotes(manifest, permissions); err != nil {
		return err
	}
	dependencies := make(map[string]bool, len(manifest.Requires))
	for _, dependency := range manifest.Requires {
		if !validArtifactID(dependency.ID) || dependency.ID == manifest.ID || dependencies[dependency.ID] ||
			(dependency.MinVersion != "" && !validArtifactVersion(dependency.MinVersion)) {
			return fmt.Errorf("invalid or duplicate dependency")
		}
		dependencies[dependency.ID] = true
	}
	return nil
}

func validArtifactID(id string) bool {
	if len(id) > 128 || !strings.Contains(id, ".") {
		return false
	}
	for _, segment := range strings.Split(id, ".") {
		if !artifactIDSegmentPattern.MatchString(segment) || strings.HasSuffix(segment, "-") {
			return false
		}
	}
	return true
}

func validArtifactVersion(version string) bool {
	if len(version) > 128 || !artifactVersionPattern.MatchString(version) {
		return false
	}
	base, _, _ := strings.Cut(version, "+")
	_, prerelease, _ := strings.Cut(base, "-")
	for _, identifier := range strings.Split(prerelease, ".") {
		if len(identifier) > 1 && identifier[0] == '0' && strings.Trim(identifier, "0123456789") == "" {
			return false
		}
	}
	return true
}

func artifactText(text string, limit int) bool {
	return strings.TrimSpace(text) != "" && artifactOptionalText(text, limit)
}

func artifactOptionalText(text string, limit int) bool {
	return len(text) <= limit && !strings.ContainsRune(text, 0)
}

func (index *artifactIndex) reference(name string) error {
	if err := safeArtifactPath(name); err != nil {
		return err
	}
	entry, exists := index.paths[foldArtifactPath(name)]
	if !exists || entry.name != name || entry.directory || !entry.explicit || name == artifactManifestName {
		return fmt.Errorf("entry must reference an exact regular package file")
	}
	return nil
}

func (index *artifactIndex) validateBackend(backend *artifactBackend) ([]string, error) {
	if backend == nil {
		return []string{"any"}, nil
	}
	if (backend.Default == nil && len(backend.Platforms) == 0) || len(backend.Platforms) > 16 {
		return nil, fmt.Errorf("backend requires an entry and at most 16 platform entries")
	}
	platforms := make([]string, 0, len(backend.Platforms)+1)
	if backend.Default != nil {
		if err := index.validateEntry(*backend.Default); err != nil {
			return nil, err
		}
		platforms = append(platforms, "any")
	}
	for platform, entry := range backend.Platforms {
		if !artifactPlatformPattern.MatchString(platform) {
			return nil, fmt.Errorf("unsupported backend platform %q", platform)
		}
		if err := index.validateEntry(entry); err != nil {
			return nil, err
		}
		platforms = append(platforms, platform)
	}
	sort.Strings(platforms)
	return platforms, nil
}

func (index *artifactIndex) validateEntry(entry artifactEntry) error {
	if err := index.reference(entry.Executable); err != nil {
		return fmt.Errorf("backend executable: %w", err)
	}
	if entry.Runtime != "" && entry.Runtime != "native" && entry.Runtime != "node" && entry.Runtime != "python" {
		return fmt.Errorf("unsupported backend runtime")
	}
	if len(entry.Args) > 64 {
		return fmt.Errorf("too many backend arguments")
	}
	for _, argument := range entry.Args {
		if !artifactOptionalText(argument, 4096) {
			return fmt.Errorf("invalid backend argument")
		}
	}
	return nil
}

func validateArtifactSchema(raw json.RawMessage) error {
	if len(raw) == 0 {
		return nil
	}
	if len(raw) > 64<<10 || bytes.TrimSpace(raw)[0] != '{' {
		return fmt.Errorf("schema must be an object of at most 64 kib")
	}
	return nil
}
