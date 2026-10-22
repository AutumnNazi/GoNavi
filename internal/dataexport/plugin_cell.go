package dataexport

import (
	"encoding/base64"
	"encoding/json"
	"math"
	"reflect"
	"regexp"
	"strconv"
	"time"
)

var pluginExportNumber = regexp.MustCompile(`^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$`)

func pluginExportCell(value any, exists bool, budget *pluginExportBudget) (PluginExportCell, error) {
	if err := budget.addNodes(2, 3); err != nil {
		return PluginExportCell{}, err
	}
	if !exists {
		return PluginExportCell{Kind: "missing"}, nil
	}
	if value == nil {
		return PluginExportCell{Kind: "null"}, nil
	}
	switch v := value.(type) {
	case json.RawMessage:
		text, err := pluginExportJSONValue(reflect.ValueOf(v), budget)
		return pluginExportValueCell("json", text, err)
	case time.Time:
		text := v.Format(time.RFC3339Nano)
		parsed, err := time.Parse(time.RFC3339Nano, text)
		if err != nil || !parsed.Equal(v) {
			return PluginExportCell{}, ErrPluginExportSnapshot
		}
		return pluginExportTopText("string", text, budget)
	case []byte:
		if v == nil {
			return PluginExportCell{Kind: "null"}, nil
		}
		if len(v) > pluginExportCellBytes/4*3 {
			return PluginExportCell{}, ErrPluginExportSnapshot
		}
		return pluginExportTopText("binary", base64.StdEncoding.EncodeToString(v), budget)
	}
	reflected := reflect.ValueOf(value)
	if pluginExportCustom(reflected) {
		return PluginExportCell{}, ErrPluginExportSnapshot
	}
	if (reflected.Kind() == reflect.Map || reflected.Kind() == reflect.Slice) && reflected.IsNil() {
		return PluginExportCell{Kind: "null"}, nil
	}
	kind, text, ok, err := pluginExportScalar(reflected)
	if err != nil {
		return PluginExportCell{}, err
	}
	if ok {
		return pluginExportTopText(kind, text, budget)
	}
	if reflected.Kind() != reflect.Map && reflected.Kind() != reflect.Slice && reflected.Kind() != reflect.Array {
		return PluginExportCell{}, ErrPluginExportSnapshot
	}
	text, err = pluginExportJSONValue(reflected, budget)
	return pluginExportValueCell("json", text, err)
}
func pluginExportTopText(kind, text string, budget *pluginExportBudget) (PluginExportCell, error) {
	if err := budget.addNodes(1, 4); err != nil {
		return PluginExportCell{}, err
	}
	return pluginExportValueCell(kind, text, budget.addText(text))
}
func pluginExportValueCell(kind, text string, err error) (PluginExportCell, error) {
	if err != nil {
		return PluginExportCell{}, err
	}
	return PluginExportCell{Kind: kind, Value: &text}, nil
}
func pluginExportScalar(value reflect.Value) (string, string, bool, error) {
	if value.CanInterface() {
		if number, ok := value.Interface().(json.Number); ok {
			raw := string(number)
			if !pluginExportNumeric(raw) {
				return "", "", false, ErrPluginExportSnapshot
			}
			return "number", raw, true, nil
		}
	}
	switch value.Kind() {
	case reflect.String:
		return "string", value.String(), true, nil
	case reflect.Bool:
		return "boolean", strconv.FormatBool(value.Bool()), true, nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return "number", strconv.FormatInt(value.Int(), 10), true, nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return "number", strconv.FormatUint(value.Uint(), 10), true, nil
	case reflect.Float32, reflect.Float64:
		number := value.Float()
		if math.IsNaN(number) || math.IsInf(number, 0) || (math.Trunc(number) == number && math.Abs(number) > 9007199254740991) {
			return "", "", false, ErrPluginExportSnapshot
		}
		return "number", strconv.FormatFloat(number, 'g', -1, value.Type().Bits()), true, nil
	}
	return "", "", false, nil
}
func pluginExportNumeric(text string) bool {
	return len(text) <= 256 && pluginExportNumber.MatchString(text)
}
