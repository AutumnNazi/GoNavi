package plugin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"unicode/utf8"
)

// UnmarshalJSON rejects ambiguous skill declarations without interpreting document content.
func (skill *Skill) UnmarshalJSON(data []byte) error {
	if !utf8.Valid(data) {
		return fmt.Errorf("skill metadata must be UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	opening, err := decoder.Token()
	if err != nil {
		return fmt.Errorf("decode skill: %w", err)
	}
	if opening != json.Delim('{') {
		return fmt.Errorf("skill declaration must be an object")
	}
	fields := make(map[string]bool, 4)
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return fmt.Errorf("decode skill field: %w", err)
		}
		name, ok := token.(string)
		if !ok || !skillJSONField(name) {
			return fmt.Errorf("unknown skill field")
		}
		if fields[name] {
			return fmt.Errorf("duplicate skill field")
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return fmt.Errorf("decode skill value: %w", err)
		}
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("skill fields cannot be null")
		}
		fields[name] = true
	}
	if _, err := decoder.Token(); err != nil {
		return fmt.Errorf("decode skill object: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("skill declaration has trailing data")
	}
	for _, name := range []string{"id", "name", "description", "entry"} {
		if !fields[name] {
			return fmt.Errorf("skill is missing required field %s", name)
		}
	}
	type wireSkill Skill
	var decoded wireSkill
	if err := json.Unmarshal(data, &decoded); err != nil {
		return fmt.Errorf("decode skill fields: %w", err)
	}
	*skill = Skill(decoded)
	return nil
}

func skillJSONField(name string) bool {
	switch name {
	case "id", "name", "description", "entry", "resources":
		return true
	default:
		return false
	}
}
