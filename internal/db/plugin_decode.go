package db

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"strconv"
	"unicode/utf8"
)

const pluginDatabaseMaxJSONDepth = 16
const pluginDatabaseMaxJSONNodes = 250000

type pluginDatabaseJSONBudget struct{ nodes int }

func validatePluginDatabaseJSON(payload []byte) error {
	if len(payload) == 0 || len(payload) > pluginDatabaseMaxJSON || !utf8.Valid(payload) {
		return ErrPluginDatabaseProtocol
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	budget := pluginDatabaseJSONBudget{}
	if err := budget.value(decoder, 0); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return ErrPluginDatabaseProtocol
	}
	return nil
}

func (b *pluginDatabaseJSONBudget) value(decoder *json.Decoder, depth int) error {
	b.nodes++
	if depth > pluginDatabaseMaxJSONDepth || b.nodes > pluginDatabaseMaxJSONNodes {
		return ErrPluginDatabaseProtocol
	}
	token, err := decoder.Token()
	if err != nil {
		return ErrPluginDatabaseProtocol
	}
	switch value := token.(type) {
	case json.Delim:
		switch value {
		case '{':
			return b.object(decoder, depth+1)
		case '[':
			for decoder.More() {
				if err := b.value(decoder, depth+1); err != nil {
					return err
				}
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim(']') {
				return ErrPluginDatabaseProtocol
			}
		default:
			return ErrPluginDatabaseProtocol
		}
	case string:
		if !validPluginDatabaseText(value, pluginDatabaseMaxQuery, false) {
			return ErrPluginDatabaseProtocol
		}
	case json.Number:
		if len(value) > 1024 {
			return ErrPluginDatabaseProtocol
		}
		numeric, err := strconv.ParseFloat(string(value), 64)
		if err != nil || math.IsInf(numeric, 0) || math.IsNaN(numeric) {
			return ErrPluginDatabaseProtocol
		}
	case bool, nil:
	default:
		return ErrPluginDatabaseProtocol
	}
	return nil
}

func (b *pluginDatabaseJSONBudget) object(decoder *json.Decoder, depth int) error {
	seen := make(map[string]struct{})
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return ErrPluginDatabaseProtocol
		}
		name, ok := key.(string)
		if !ok || !validPluginDatabaseText(name, pluginDatabaseMaxName, false) {
			return ErrPluginDatabaseProtocol
		}
		if _, exists := seen[name]; exists {
			return ErrPluginDatabaseProtocol
		}
		seen[name] = struct{}{}
		if err := b.value(decoder, depth); err != nil {
			return err
		}
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') {
		return ErrPluginDatabaseProtocol
	}
	return nil
}

func pluginDatabaseEnvelope(payload json.RawMessage, fields ...string) (map[string]json.RawMessage, error) {
	if err := validatePluginDatabaseJSON(payload); err != nil {
		return nil, err
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(payload, &envelope); err != nil || len(envelope) != len(fields) {
		return nil, ErrPluginDatabaseProtocol
	}
	for _, name := range fields {
		value, exists := envelope[name]
		if !exists || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return nil, ErrPluginDatabaseProtocol
		}
	}
	return envelope, nil
}

func decodePluginDatabaseValue(payload json.RawMessage, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return ErrPluginDatabaseProtocol
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return ErrPluginDatabaseProtocol
	}
	return nil
}

func decodePluginDatabaseArray[T any](payload json.RawMessage, required []string) ([]T, error) {
	var rows []json.RawMessage
	if err := decodePluginDatabaseValue(payload, &rows); err != nil || rows == nil || len(rows) > pluginDatabaseMaxRows {
		return nil, ErrPluginDatabaseProtocol
	}
	allowed := make(map[string]struct{}, len(required)+6)
	for _, key := range append(append([]string(nil), required...), "hasDefault", "charset", "collation", "comment", "subPart", "orientation") {
		allowed[key] = struct{}{}
	}
	result := make([]T, 0, len(rows))
	for _, row := range rows {
		var object map[string]json.RawMessage
		if err := json.Unmarshal(row, &object); err != nil || object == nil {
			return nil, ErrPluginDatabaseProtocol
		}
		for key, value := range object {
			if _, ok := allowed[key]; !ok {
				return nil, ErrPluginDatabaseProtocol
			}
			if key != "default" && bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
				return nil, ErrPluginDatabaseProtocol
			}
		}
		for _, key := range required {
			value, exists := object[key]
			if !exists || (key != "default" && bytes.Equal(bytes.TrimSpace(value), []byte("null"))) {
				return nil, ErrPluginDatabaseProtocol
			}
		}
		var item T
		if err := decodePluginDatabaseValue(row, &item); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}
