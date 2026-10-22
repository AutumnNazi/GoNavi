package provider

import (
	"bytes"
	"encoding/json"
	"io"
	"reflect"
	"strconv"
	"strings"
	"unicode/utf8"
)

func pluginJSON(raw []byte, limit int) error {
	if len(raw) == 0 || len(raw) > limit || !utf8.Valid(raw) || !json.Valid(raw) || !pluginJSONUnicode(raw) {
		return ErrPluginProviderResponse
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	nodes := 0
	if err := pluginJSONValue(d, 0, &nodes); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return ErrPluginProviderResponse
	}
	return nil
}
func pluginJSONValue(d *json.Decoder, depth int, nodes *int) error {
	*nodes++
	if depth > 32 || *nodes > 32768 {
		return ErrPluginProviderResponse
	}
	token, err := d.Token()
	if err != nil {
		return ErrPluginProviderResponse
	}
	delim, container := token.(json.Delim)
	if !container {
		return nil
	}
	if delim != '{' && delim != '[' {
		return ErrPluginProviderResponse
	}
	seen := map[string]bool{}
	for d.More() {
		if delim == '{' {
			key, err := d.Token()
			name, ok := key.(string)
			if err != nil || !ok || seen[name] {
				return ErrPluginProviderResponse
			}
			seen[name] = true
			*nodes++
		}
		if err := pluginJSONValue(d, depth+1, nodes); err != nil {
			return err
		}
	}
	end, err := d.Token()
	if err != nil || (delim == '{' && end != json.Delim('}')) || (delim == '[' && end != json.Delim(']')) {
		return ErrPluginProviderResponse
	}
	return nil
}
func pluginJSONUnicode(raw []byte) bool {
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

func pluginDecodeObject(raw []byte, target any) error {
	if err := pluginExactObject(raw, reflect.TypeOf(target).Elem()); err != nil {
		return err
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		return ErrPluginProviderResponse
	}
	return nil
}
func pluginObjectFields(typ reflect.Type, result map[string]reflect.Type) {
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		if field.Anonymous {
			pluginObjectFields(field.Type, result)
			continue
		}
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		if name != "" && name != "-" {
			result[name] = field.Type
		}
	}
}
func pluginExactObject(raw []byte, typ reflect.Type) error {
	if typ.Kind() == reflect.Pointer {
		typ = typ.Elem()
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil || object == nil {
		return ErrPluginProviderResponse
	}
	fields := make(map[string]reflect.Type)
	pluginObjectFields(typ, fields)
	for key, value := range object {
		field, ok := fields[key]
		if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return ErrPluginProviderResponse
		}
		if field.Kind() == reflect.Pointer {
			field = field.Elem()
		}
		if field.Kind() == reflect.Struct {
			if err := pluginExactObject(value, field); err != nil {
				return err
			}
		}
		if field.Kind() == reflect.Slice && field.Elem().Kind() == reflect.Struct {
			var elements []json.RawMessage
			if json.Unmarshal(value, &elements) != nil {
				return ErrPluginProviderResponse
			}
			for _, element := range elements {
				if err := pluginExactObject(element, field.Elem()); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
