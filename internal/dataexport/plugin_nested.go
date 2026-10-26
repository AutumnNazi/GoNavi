package dataexport

import (
	"encoding"
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"time"
)

func pluginExportCustom(value reflect.Value) bool {
	if !value.IsValid() || !value.CanInterface() {
		return false
	}
	if _, ok := value.Interface().(json.Marshaler); ok {
		return true
	}
	_, ok := value.Interface().(encoding.TextMarshaler)
	return ok
}
func pluginExportJSONValue(value reflect.Value, budget *pluginExportBudget) (string, error) {
	if err := pluginExportPreflight(value, budget, 4); err != nil {
		return "", err
	}
	writer := pluginExportJSONWriter{budget: budget}
	if err := writer.value(value, 4); err != nil {
		return "", err
	}
	return writer.text.String(), nil
}
func pluginExportPreflight(value reflect.Value, budget *pluginExportBudget, depth int) error {
	if value.IsValid() && value.Kind() == reflect.Interface {
		if value.IsNil() {
			value = reflect.Value{}
		} else {
			return pluginExportPreflight(value.Elem(), budget, depth)
		}
	}
	if value.IsValid() && value.CanInterface() {
		switch v := value.Interface().(type) {
		case json.RawMessage:
			return pluginExportCheckJSON(v, pluginExportCellBytes, budget, depth)
		case []byte, time.Time:
			return ErrPluginExportSnapshot
		}
	}
	if pluginExportCustom(value) {
		return ErrPluginExportSnapshot
	}
	if err := budget.addNodes(1, depth); err != nil {
		return err
	}
	if !value.IsValid() {
		return nil
	}
	if (value.Kind() == reflect.Map || value.Kind() == reflect.Slice) && value.IsNil() {
		return nil
	}
	_, text, scalar, err := pluginExportScalar(value)
	if err != nil {
		return err
	}
	if scalar {
		return budget.addText(text)
	}
	switch value.Kind() {
	case reflect.Map:
		if value.Type().Key().Kind() != reflect.String || value.Len() > pluginExportMaxNodes-budget.nodes {
			return ErrPluginExportSnapshot
		}
		iter := value.MapRange()
		for iter.Next() {
			if err := budget.addText(iter.Key().String()); err != nil {
				return err
			}
			if err := pluginExportPreflight(iter.Value(), budget, depth+1); err != nil {
				return err
			}
		}
	case reflect.Array, reflect.Slice:
		if value.Len() > pluginExportMaxNodes-budget.nodes {
			return ErrPluginExportSnapshot
		}
		for i := 0; i < value.Len(); i++ {
			if err := pluginExportPreflight(value.Index(i), budget, depth+1); err != nil {
				return err
			}
		}
	default:
		return ErrPluginExportSnapshot
	}
	return nil
}

type pluginExportJSONWriter struct {
	text   strings.Builder
	budget *pluginExportBudget
}

func (w *pluginExportJSONWriter) append(text string) error {
	if err := w.budget.ctx.Err(); err != nil {
		return err
	}
	if len(text) > pluginExportCellBytes-w.text.Len() {
		return ErrPluginExportSnapshot
	}
	w.text.WriteString(text)
	return nil
}
func (w *pluginExportJSONWriter) quoted(text string) error {
	if len(text) > pluginExportCellBytes {
		return ErrPluginExportSnapshot
	}
	raw, err := json.Marshal(text)
	if err != nil {
		return ErrPluginExportSnapshot
	}
	return w.append(string(raw))
}
func (w *pluginExportJSONWriter) value(value reflect.Value, depth int) error {
	if depth > pluginExportMaxDepth {
		return ErrPluginExportSnapshot
	}
	if value.IsValid() && value.Kind() == reflect.Interface {
		if value.IsNil() {
			value = reflect.Value{}
		} else {
			return w.value(value.Elem(), depth)
		}
	}
	if !value.IsValid() {
		return w.append("null")
	}
	if value.CanInterface() {
		if raw, ok := value.Interface().(json.RawMessage); ok {
			parsed, err := pluginExportDecodeJSON(raw)
			if err != nil {
				return err
			}
			return w.value(reflect.ValueOf(parsed), depth)
		}
	}
	if (value.Kind() == reflect.Map || value.Kind() == reflect.Slice) && value.IsNil() {
		return w.append("null")
	}
	kind, text, scalar, err := pluginExportScalar(value)
	if err != nil {
		return err
	}
	if scalar {
		if kind == "string" {
			return w.quoted(text)
		}
		return w.append(text)
	}
	switch value.Kind() {
	case reflect.Map:
		return w.object(value, depth)
	case reflect.Array, reflect.Slice:
		if err = w.append("["); err != nil {
			return err
		}
		for i := 0; i < value.Len(); i++ {
			if i > 0 {
				if err = w.append(","); err != nil {
					return err
				}
			}
			if err = w.value(value.Index(i), depth+1); err != nil {
				return err
			}
		}
		return w.append("]")
	}
	return ErrPluginExportSnapshot
}
func (w *pluginExportJSONWriter) object(value reflect.Value, depth int) error {
	keys := make([]string, 0, value.Len())
	iter := value.MapRange()
	for iter.Next() {
		keys = append(keys, iter.Key().String())
	}
	sort.Strings(keys)
	if err := w.append("{"); err != nil {
		return err
	}
	for i, key := range keys {
		if i > 0 {
			if err := w.append(","); err != nil {
				return err
			}
		}
		if err := w.quoted(key); err != nil {
			return err
		}
		if err := w.append(":"); err != nil {
			return err
		}
		mapKey := reflect.ValueOf(key).Convert(value.Type().Key())
		if err := w.value(value.MapIndex(mapKey), depth+1); err != nil {
			return err
		}
	}
	return w.append("}")
}
