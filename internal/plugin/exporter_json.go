package plugin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"unicode/utf8"
)

// UnmarshalJSON rejects ambiguous declarations atomically; validation checks semantic bounds.
func (exporter *Exporter) UnmarshalJSON(raw []byte) error {
	if err := validateExporterObject(raw, []string{"id", "name", "command", "extension", "contentType"}, "streaming"); err != nil {
		return err
	}
	type wireExporter Exporter
	var decoded wireExporter
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return fmt.Errorf("decode exporter: %w", err)
	}
	*exporter = Exporter(decoded)
	return nil
}

func validateExporterObject(raw []byte, required []string, optional ...string) error {
	if !utf8.Valid(raw) {
		return fmt.Errorf("exporter JSON must be UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	first, err := decoder.Token()
	if err != nil {
		return fmt.Errorf("decode exporter object: %w", err)
	}
	if first != json.Delim('{') {
		return fmt.Errorf("exporter JSON must be an object")
	}
	allowed := make(map[string]bool, len(required)+len(optional))
	for _, key := range required {
		allowed[key] = true
	}
	for _, key := range optional {
		allowed[key] = true
	}
	seen := make(map[string]bool, len(required)+len(optional))
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return fmt.Errorf("decode exporter key: %w", err)
		}
		key, ok := token.(string)
		if !ok || !allowed[key] || seen[key] {
			return fmt.Errorf("unknown or duplicate exporter field")
		}
		var value json.RawMessage
		if err = decoder.Decode(&value); err != nil {
			return fmt.Errorf("decode exporter value: %w", err)
		}
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("exporter fields cannot be null")
		}
		seen[key] = true
	}
	if _, err = decoder.Token(); err != nil {
		return fmt.Errorf("decode exporter object end: %w", err)
	}
	if err = decoder.Decode(new(json.RawMessage)); err != io.EOF {
		return fmt.Errorf("exporter JSON has trailing data")
	}
	for _, key := range required {
		if !seen[key] {
			return fmt.Errorf("exporter is missing required field %s", key)
		}
	}
	return nil
}

func validateExporterArguments(raw json.RawMessage, exporterID string) error {
	if len(raw) == 0 || len(raw) > maxExporterJSONBytes {
		return fmt.Errorf("invalid or oversized exporter arguments")
	}
	if err := validateExporterObject(raw, []string{"protocolVersion", "exporterId", "columns", "rows"}, "chunkIndex", "chunkCount"); err != nil {
		return err
	}
	var header struct {
		ProtocolVersion int             `json:"protocolVersion"`
		ExporterID      string          `json:"exporterId"`
		Columns         json.RawMessage `json:"columns"`
		Rows            json.RawMessage `json:"rows"`
		ChunkIndex      *int            `json:"chunkIndex"`
		ChunkCount      *int            `json:"chunkCount"`
	}
	if err := json.Unmarshal(raw, &header); err != nil {
		return fmt.Errorf("invalid exporter request binding")
	}
	if header.ExporterID != exporterID || !exporterIDPattern.MatchString(exporterID) {
		return fmt.Errorf("invalid exporter request binding")
	}
	switch header.ProtocolVersion {
	case 1:
		if header.ChunkIndex != nil || header.ChunkCount != nil {
			return fmt.Errorf("exporter protocol version 1 has no chunk fields")
		}
	case 2:
		if header.ChunkIndex == nil || header.ChunkCount == nil || *header.ChunkCount < 1 || *header.ChunkIndex < 0 || *header.ChunkIndex >= *header.ChunkCount || *header.ChunkCount > 1<<20 {
			return fmt.Errorf("invalid exporter chunk binding")
		}
	default:
		return fmt.Errorf("invalid exporter request binding")
	}
	for _, array := range []json.RawMessage{header.Columns, header.Rows} {
		trimmed := bytes.TrimSpace(array)
		if len(trimmed) == 0 || trimmed[0] != '[' {
			return fmt.Errorf("exporter columns and rows must be arrays")
		}
	}
	return nil
}
