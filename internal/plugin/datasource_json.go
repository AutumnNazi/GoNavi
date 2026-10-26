package plugin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

// UnmarshalJSON requires one unambiguous declaration with an explicit readOnly value.
// The containing manifest decoder otherwise accepts case aliases and duplicate keys.
func (source *DataSource) UnmarshalJSON(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	opening, err := decoder.Token()
	if err != nil {
		return fmt.Errorf("decode data source: %w", err)
	}
	if opening != json.Delim('{') {
		return fmt.Errorf("data source declaration must be an object")
	}
	fields := make(map[string]json.RawMessage, 6)
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return fmt.Errorf("decode data source field: %w", err)
		}
		name, ok := token.(string)
		if !ok || !dataSourceJSONField(name) {
			return fmt.Errorf("unknown data source field")
		}
		if _, exists := fields[name]; exists {
			return fmt.Errorf("duplicate data source field")
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return fmt.Errorf("decode data source value: %w", err)
		}
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("data source fields cannot be null")
		}
		fields[name] = value
	}
	if _, err := decoder.Token(); err != nil {
		return fmt.Errorf("decode data source object: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("data source declaration has trailing data")
	}
	for _, required := range []string{"id", "name", "dialect", "command", "readOnly"} {
		if _, exists := fields[required]; !exists {
			return fmt.Errorf("data source is missing required field %s", required)
		}
	}
	// A distinct type avoids recursively invoking this method while keeping one wire shape.
	type wireSource DataSource
	var decoded wireSource
	if err := json.Unmarshal(data, &decoded); err != nil {
		return fmt.Errorf("decode data source fields: %w", err)
	}
	*source = DataSource(decoded)
	return nil
}

func dataSourceJSONField(name string) bool {
	switch name {
	case "id", "name", "dialect", "command", "defaultPort", "readOnly":
		return true
	default:
		return false
	}
}
