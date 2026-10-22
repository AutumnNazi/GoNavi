package market

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"unicode/utf8"
)

type artifactManifest struct {
	SchemaVersion   int                   `json:"schemaVersion"`
	APIVersion      int                   `json:"apiVersion"`
	ID              string                `json:"id"`
	Name            string                `json:"name"`
	Version         string                `json:"version"`
	Description     string                `json:"description,omitempty"`
	Author          string                `json:"author,omitempty"`
	License         string                `json:"license,omitempty"`
	MinHostVersion  string                `json:"minHostVersion,omitempty"`
	Permissions     []string              `json:"permissions"`
	PermissionNotes map[string]string     `json:"permissionNotes,omitempty"`
	Requires        []artifactDependency  `json:"requires,omitempty"`
	Backend         *artifactBackend      `json:"backend,omitempty"`
	Contributes     artifactContributions `json:"contributes,omitempty"`
	Window          *artifactWindow       `json:"window,omitempty"`
	ConfigSchema    json.RawMessage       `json:"configSchema,omitempty"`
}

type artifactDependency struct {
	ID         string `json:"id"`
	MinVersion string `json:"minVersion,omitempty"`
	Optional   bool   `json:"optional,omitempty"`
}

type artifactBackend struct {
	Default   *artifactEntry           `json:"default,omitempty"`
	Platforms map[string]artifactEntry `json:"platforms,omitempty"`
}

type artifactEntry struct {
	Executable string   `json:"executable"`
	Args       []string `json:"args,omitempty"`
	Runtime    string   `json:"runtime,omitempty"`
}

type artifactContributions struct {
	Commands    []artifactCommand    `json:"commands,omitempty"`
	Panels      []artifactPanel      `json:"panels,omitempty"`
	DataSources []artifactDataSource `json:"dataSources,omitempty"`
	Skills      []artifactSkill      `json:"skills,omitempty"`
	AIProviders []artifactAIProvider `json:"aiProviders,omitempty"`
	Exporters   []artifactExporter   `json:"exporters,omitempty"`
}

type artifactCommand struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"inputSchema,omitempty"`
	Effect      string          `json:"effect,omitempty"`
}

type artifactPanel struct {
	ID    string         `json:"id"`
	Title string         `json:"title"`
	Body  artifactUINode `json:"body"`
}

type artifactUINode struct {
	Type      string                       `json:"type"`
	Text      string                       `json:"text,omitempty"`
	Title     string                       `json:"title,omitempty"`
	Children  []artifactUINode             `json:"children,omitempty"`
	Command   string                       `json:"command,omitempty"`
	Arguments json.RawMessage              `json:"arguments,omitempty"`
	Columns   []artifactColumn             `json:"columns,omitempty"`
	Rows      []map[string]json.RawMessage `json:"rows,omitempty"`
}

type artifactColumn struct {
	Key   string `json:"key"`
	Title string `json:"title"`
}

type artifactWindow struct {
	Entry  string `json:"entry"`
	Title  string `json:"title,omitempty"`
	Width  int    `json:"width,omitempty"`
	Height int    `json:"height,omitempty"`
}

func decodeArtifactManifest(raw []byte) (artifactManifest, error) {
	var manifest artifactManifest
	if len(raw) == 0 || len(raw) > maxArtifactManifestBytes || !utf8.Valid(raw) {
		return manifest, fmt.Errorf("missing, oversized, or non-utf8 root manifest")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := checkArtifactJSON(decoder, 0); err != nil {
		return manifest, fmt.Errorf("decode manifest: %w", err)
	}
	if _, err := decoder.Token(); err != io.EOF {
		return manifest, fmt.Errorf("manifest has trailing data")
	}
	if err := checkArtifactShape(raw, reflect.TypeOf(manifest)); err != nil {
		return manifest, err
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return manifest, fmt.Errorf("decode manifest fields: %w", err)
	}
	return manifest, nil
}

// encoding/json accepts duplicate keys and case-insensitive field names by
// default. Packages must have one unambiguous declaration across consumers.
func checkArtifactJSON(decoder *json.Decoder, depth int) error {
	if depth > 64 {
		return fmt.Errorf("manifest json exceeds nesting limit")
	}
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, composite := token.(json.Delim)
	if !composite {
		return nil
	}
	if delimiter != '{' && delimiter != '[' {
		return fmt.Errorf("unexpected json delimiter")
	}
	keys := make(map[string]bool)
	for decoder.More() {
		if delimiter == '{' {
			keyToken, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok || keys[key] {
				return fmt.Errorf("duplicate or invalid json object key")
			}
			keys[key] = true
		}
		if err := checkArtifactJSON(decoder, depth+1); err != nil {
			return err
		}
	}
	_, err = decoder.Token()
	return err
}

func checkArtifactShape(raw []byte, shape reflect.Type) error {
	if shape == reflect.TypeOf(json.RawMessage{}) {
		return nil
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return fmt.Errorf("manifest fields cannot be null")
	}
	if shape.Kind() == reflect.Pointer {
		return checkArtifactShape(raw, shape.Elem())
	}
	switch shape.Kind() {
	case reflect.Struct:
		return checkArtifactObject(raw, shape)
	case reflect.Map:
		var values map[string]json.RawMessage
		if err := json.Unmarshal(raw, &values); err != nil {
			return fmt.Errorf("manifest field must be an object: %w", err)
		}
		for _, value := range values {
			if err := checkArtifactShape(value, shape.Elem()); err != nil {
				return err
			}
		}
	case reflect.Slice:
		var values []json.RawMessage
		if err := json.Unmarshal(raw, &values); err != nil {
			return fmt.Errorf("manifest field must be an array: %w", err)
		}
		for _, value := range values {
			if err := checkArtifactShape(value, shape.Elem()); err != nil {
				return err
			}
		}
	}
	return nil
}

func safeArtifactFieldLabel(name string) string {
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

func checkArtifactObject(raw []byte, shape reflect.Type) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return fmt.Errorf("manifest declaration must be an object: %w", err)
	}
	allowed := make(map[string]reflect.Type, shape.NumField())
	for i := 0; i < shape.NumField(); i++ {
		field := shape.Field(i)
		name, _, _ := bytes.Cut([]byte(field.Tag.Get("json")), []byte(","))
		allowed[string(name)] = field.Type
	}
	for name, value := range fields {
		fieldType, ok := allowed[name]
		if !ok {
			return fmt.Errorf("unknown manifest field%s", safeArtifactFieldLabel(name))
		}
		if err := checkArtifactShape(value, fieldType); err != nil {
			return fmt.Errorf("invalid manifest field: %w", err)
		}
	}
	return nil
}
