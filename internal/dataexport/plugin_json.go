package dataexport

import (
	"bytes"
	"encoding/json"
	"io"
	"strconv"
	"unicode/utf8"
)

func pluginExportCheckJSON(raw []byte, limit int, budget *pluginExportBudget, depth int) error {
	if err := budget.ctx.Err(); err != nil {
		return err
	}
	if len(raw) == 0 || len(raw) > limit || !utf8.Valid(raw) || !json.Valid(raw) || !pluginExportUnicode(raw) {
		return ErrPluginExportSnapshot
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := pluginExportJSONToken(decoder, budget, depth); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return ErrPluginExportSnapshot
	}
	return nil
}
func pluginExportJSONToken(decoder *json.Decoder, budget *pluginExportBudget, depth int) error {
	if err := budget.addNodes(1, depth); err != nil {
		return err
	}
	token, err := decoder.Token()
	if err != nil {
		return ErrPluginExportSnapshot
	}
	switch value := token.(type) {
	case string:
		return budget.addText(value)
	case json.Number:
		if !pluginExportNumeric(string(value)) {
			return ErrPluginExportSnapshot
		}
		return budget.addText(string(value))
	case bool:
		return budget.addText("false")
	case nil:
		return nil
	case json.Delim:
		if value != '{' && value != '[' {
			return ErrPluginExportSnapshot
		}
		seen := map[string]bool{}
		for decoder.More() {
			if value == '{' {
				key, err := decoder.Token()
				name, ok := key.(string)
				if err != nil || !ok || seen[name] {
					return ErrPluginExportSnapshot
				}
				seen[name] = true
				if err := budget.addText(name); err != nil {
					return err
				}
			}
			if err := pluginExportJSONToken(decoder, budget, depth+1); err != nil {
				return err
			}
		}
		end, err := decoder.Token()
		if err != nil || (value == '{' && end != json.Delim('}')) || (value == '[' && end != json.Delim(']')) {
			return ErrPluginExportSnapshot
		}
		return nil
	}
	return ErrPluginExportSnapshot
}
func pluginExportDecodeJSON(raw []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, ErrPluginExportSnapshot
	}
	return value, nil
}
func pluginExportUnicode(raw []byte) bool {
	for i := 0; i < len(raw); i++ {
		if raw[i] != 34 {
			continue
		}
		i++
		for i < len(raw) && raw[i] != 34 {
			if raw[i] == 92 {
				i++
				if raw[i] == 'u' {
					value, err := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
					if err != nil {
						return false
					}
					i += 4
					if value >= 0xd800 && value <= 0xdbff {
						if i+6 >= len(raw) || raw[i+1] != 92 || raw[i+2] != 'u' {
							return false
						}
						low, err := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
						if err != nil || low < 0xdc00 || low > 0xdfff {
							return false
						}
						i += 6
					} else if value >= 0xdc00 && value <= 0xdfff {
						return false
					}
				}
			}
			i++
		}
	}
	return true
}
