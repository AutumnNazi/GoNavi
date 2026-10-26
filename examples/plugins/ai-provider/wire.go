package main

import (
	"bytes"
	"encoding/json"
	"io"
	"strconv"
	"unicode/utf8"
)

func isNull(raw json.RawMessage) bool { return bytes.Equal(bytes.TrimSpace(raw), []byte("null")) }

func wireObject(raw json.RawMessage) (map[string]json.RawMessage, error) {
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil || object == nil {
		return nil, failure("generation_failed")
	}
	return object, nil
}

func wireString(raw json.RawMessage) (string, error) {
	if len(raw) == 0 || isNull(raw) {
		return "", nil
	}
	var value string
	if json.Unmarshal(raw, &value) != nil || !utf8.ValidString(value) {
		return "", failure("generation_failed")
	}
	return value, nil
}

func wireCount(raw json.RawMessage) (int64, error) {
	var value int64
	if len(raw) == 0 || isNull(raw) || json.Unmarshal(raw, &value) != nil || value < 0 || value > 9007199254740991 {
		return 0, failure("generation_failed")
	}
	return value, nil
}

func validateWireJSON(raw []byte) error {
	if !utf8.Valid(raw) || !validWireUnicode(raw) {
		return failure("generation_failed")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	nodes := 0
	if err := scanWireJSON(decoder, 0, &nodes); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return failure("generation_failed")
	}
	return nil
}

func validWireUnicode(raw []byte) bool {
	// encoding/json replaces unpaired escaped surrogates. Reject them before decoding.
	quoted := false
	for index := 0; index < len(raw); index++ {
		if raw[index] == '"' {
			quoted = !quoted
			continue
		}
		if !quoted || raw[index] != '\\' {
			continue
		}
		index++
		if index >= len(raw) {
			return false
		}
		if raw[index] != 'u' {
			continue
		}
		if index+4 >= len(raw) {
			return false
		}
		value, err := strconv.ParseUint(string(raw[index+1:index+5]), 16, 16)
		if err != nil || (value >= 0xdc00 && value <= 0xdfff) {
			return false
		}
		index += 4
		if value < 0xd800 || value > 0xdbff {
			continue
		}
		if index+6 >= len(raw) || raw[index+1] != '\\' || raw[index+2] != 'u' {
			return false
		}
		low, err := strconv.ParseUint(string(raw[index+3:index+7]), 16, 16)
		if err != nil || low < 0xdc00 || low > 0xdfff {
			return false
		}
		index += 6
	}
	return true
}

func scanWireJSON(decoder *json.Decoder, depth int, nodes *int) error {
	*nodes++
	if depth > 32 || *nodes > 32768 {
		return failure("limit_exceeded")
	}
	token, err := decoder.Token()
	if err != nil {
		return failure("generation_failed")
	}
	switch token {
	case json.Delim('{'):
		keys := make(map[string]bool)
		for decoder.More() {
			key, err := decoder.Token()
			text, ok := key.(string)
			if err != nil || !ok || keys[text] {
				return failure("generation_failed")
			}
			keys[text] = true
			*nodes++
			if *nodes > 32768 {
				return failure("limit_exceeded")
			}
			if err := scanWireJSON(decoder, depth+1, nodes); err != nil {
				return err
			}
		}
		if end, err := decoder.Token(); err != nil || end != json.Delim('}') {
			return failure("generation_failed")
		}
	case json.Delim('['):
		for decoder.More() {
			if err := scanWireJSON(decoder, depth+1, nodes); err != nil {
				return err
			}
		}
		if end, err := decoder.Token(); err != nil || end != json.Delim(']') {
			return failure("generation_failed")
		}
	default:
		if _, delimiter := token.(json.Delim); delimiter {
			return failure("generation_failed")
		}
	}
	return nil
}
