package plugin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"

	"golang.org/x/mod/semver"
)

const manifestName = "gonavi.plugin.json"

// safeFieldLabel renders a field name for a diagnostic only when it is short and printable.
// Oversized or non-ASCII names stay hidden so a hostile manifest cannot echo payload text.
func safeFieldLabel(name string) string {
	if len(name) == 0 || len(name) > 64 {
		return ""
	}
	for i := 0; i < len(name); i++ {
		if name[i] < 0x20 || name[i] > 0x7e {
			return ""
		}
	}
	return " \"" + name + "\""
}

// unknownFieldLabel extracts `json: unknown field "x"` so typos stay diagnosable.
func unknownFieldLabel(message string) string {
	start := strings.Index(message, "unknown field ")
	if start < 0 {
		return ""
	}
	name := strings.Trim(strings.TrimSpace(message[start+len("unknown field "):]), "\"")
	return safeFieldLabel(name)
}

const maxManifestBytes = 1 << 20

var pluginIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$`)
var localIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`)
var permissionPattern = regexp.MustCompile(`^[a-z][a-z0-9._:-]{0,127}$`)
var platformPattern = regexp.MustCompile(`^(windows|linux|darwin)/(amd64|arm64|386|arm)$`)

// ParseManifest strictly decodes and validates a version-one declaration.
func ParseManifest(data []byte) (Manifest, error) {
	var m Manifest
	if len(data) > maxManifestBytes {
		return m, fmt.Errorf("manifest exceeds size limit")
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		if strings.Contains(err.Error(), "unknown field") {
			return m, fmt.Errorf("unknown manifest field%s", unknownFieldLabel(err.Error()))
		}
		return m, fmt.Errorf("decode plugin manifest: %w", err)
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return m, fmt.Errorf("manifest has trailing data")
	}
	if err := ValidateManifest(m); err != nil {
		return m, err
	}
	return m, nil
}

// ValidateManifest rejects unsupported schemas and unsafe declarations, without execution.
func ValidateManifest(m Manifest) error {
	if m.SchemaVersion != 1 || m.APIVersion != 1 {
		return fmt.Errorf("unsupported plugin schema or api version")
	}
	if !validPluginID(m.ID) || !validText(m.Name, 256) || !validVersion(m.Version) {
		return fmt.Errorf("invalid plugin id, name, or version")
	}
	if len(m.Description) > 16384 || len(m.Author) > 512 || len(m.License) > 256 {
		return fmt.Errorf("plugin metadata exceeds limit")
	}
	if m.MinHostVersion != "" && !validVersion(m.MinHostVersion) {
		return fmt.Errorf("invalid minimum host version")
	}
	if len(m.Permissions) > 64 || len(m.Requires) > 64 {
		return fmt.Errorf("too many permissions or dependencies")
	}
	seen := make(map[string]bool)
	for _, p := range m.Permissions {
		if !permissionPattern.MatchString(p) || seen[p] {
			return fmt.Errorf("invalid or duplicate permission")
		}
		seen[p] = true
	}
	if err := validatePermissionNotes(m, seen); err != nil {
		return err
	}
	permissions := seen
	seen = make(map[string]bool)
	for _, d := range m.Requires {
		if !validPluginID(d.ID) || d.ID == m.ID || seen[d.ID] || (d.MinVersion != "" && !validVersion(d.MinVersion)) {
			return fmt.Errorf("invalid or duplicate dependency")
		}
		seen[d.ID] = true
	}
	if err := validateBackend(m.Backend); err != nil {
		return err
	}
	if len(m.Contributes.Commands) > 128 || len(m.Contributes.Panels) > 32 {
		return fmt.Errorf("too many contributions")
	}
	commands := make(map[string]bool)
	for _, c := range m.Contributes.Commands {
		if !localIDPattern.MatchString(c.ID) || commands[c.ID] || !validText(c.Title, 256) || len(c.Description) > 4096 {
			return fmt.Errorf("invalid or duplicate command")
		}
		if c.Effect != "" && c.Effect != "read" && c.Effect != "write" && c.Effect != "unknown" {
			return fmt.Errorf("unsupported command effect")
		}
		if err := validateSchema(c.InputSchema); err != nil {
			return err
		}
		commands[c.ID] = true
	}
	if len(commands) > 0 && m.Backend == nil {
		return fmt.Errorf("commands require a backend")
	}
	if err := validateDataSources(m, commands); err != nil {
		return err
	}
	if err := validateSkills(m); err != nil {
		return err
	}
	if err := validateAIProviders(m, commands); err != nil {
		return err
	}
	if err := validateExporters(m, commands); err != nil {
		return err
	}
	panels := make(map[string]bool)
	nodes := 0
	for _, p := range m.Contributes.Panels {
		if !localIDPattern.MatchString(p.ID) || panels[p.ID] || !validText(p.Title, 256) {
			return fmt.Errorf("invalid or duplicate panel")
		}
		panels[p.ID] = true
		if p.HTML != nil {
			if p.Body.Type != "" {
				return fmt.Errorf("panel declares both a declarative body and custom html")
			}
			if !permissions[CustomPanelPermission] {
				return fmt.Errorf("custom html panel requires the %s permission", CustomPanelPermission)
			}
			if err := validatePanelHTML(*p.HTML); err != nil {
				return err
			}
			continue
		}
		if p.Body.Type == "" {
			return fmt.Errorf("panel declares no body")
		}
		if err := validateNode(p.Body, commands, 0, &nodes); err != nil {
			return err
		}
	}
	if m.Window != nil {
		if err := safePackagePath(m.Window.Entry); err != nil {
			return fmt.Errorf("invalid window entry: %w", err)
		}
		if len(m.Window.Title) > 256 || m.Window.Width < 0 || m.Window.Height < 0 || m.Window.Width > 8192 || m.Window.Height > 8192 {
			return fmt.Errorf("invalid window dimensions or title")
		}
	}
	return validateSchema(m.ConfigSchema)
}
func validPluginID(id string) bool {
	if len(id) > 128 || !pluginIDPattern.MatchString(id) {
		return false
	}
	for _, s := range strings.Split(id, ".") {
		if s == "" || s[0] == '-' || s[len(s)-1] == '-' {
			return false
		}
	}
	return true
}
func validText(s string, limit int) bool {
	return strings.TrimSpace(s) != "" && len(s) <= limit && !strings.ContainsRune(s, 0)
}
func validVersion(s string) bool {
	return strings.Count(strings.SplitN(strings.SplitN(s, "+", 2)[0], "-", 2)[0], ".") == 2 && !strings.HasPrefix(s, "v") && semver.IsValid("v"+s)
}
func versionAtLeast(value, minimum string) bool { return semver.Compare("v"+value, "v"+minimum) >= 0 }
func validateBackend(b *Backend) error {
	if b == nil {
		return nil
	}
	if b.Default == nil && len(b.Platforms) == 0 {
		return fmt.Errorf("backend has no entry")
	}
	if len(b.Platforms) > 16 {
		return fmt.Errorf("too many backend platforms")
	}
	if b.Default != nil {
		if err := validateEntry(*b.Default); err != nil {
			return err
		}
	}
	for platform, e := range b.Platforms {
		if !platformPattern.MatchString(platform) {
			return fmt.Errorf("unsupported backend platform")
		}
		if err := validateEntry(e); err != nil {
			return err
		}
	}
	return nil
}
func validateEntry(e Entry) error {
	if err := safePackagePath(e.Executable); err != nil {
		return fmt.Errorf("invalid executable: %w", err)
	}
	switch e.Runtime {
	case "", "native", "node", "python":
	default:
		return fmt.Errorf("unsupported backend runtime")
	}
	if len(e.Args) > 64 {
		return fmt.Errorf("too many executable arguments")
	}
	for _, a := range e.Args {
		if len(a) > 4096 || strings.ContainsRune(a, 0) {
			return fmt.Errorf("invalid executable argument")
		}
	}
	return nil
}
func validateSchema(raw json.RawMessage) error {
	if len(raw) == 0 {
		return nil
	}
	if len(raw) > 64<<10 || !json.Valid(raw) {
		return fmt.Errorf("invalid or oversized schema")
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return fmt.Errorf("schema must be an object")
	}
	return nil
}
