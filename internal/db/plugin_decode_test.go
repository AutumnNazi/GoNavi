package db

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestPluginDatabaseRejectsMalformedQueryResponses(t *testing.T) {
	manyRows := strings.Repeat(`{"id":1},`, pluginDatabaseMaxRows) + `{"id":1}`
	fields := make([]string, pluginDatabaseMaxFields+1)
	for index := range fields {
		fields[index] = fmt.Sprintf("field_%d", index)
	}
	fieldJSON, err := json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	tests := map[string]string{
		"empty": "", "null": "null", "array": "[]", "okInstead": `{"ok":true}`,
		"missingFields": `{"rows":[]}`, "nullFields": `{"rows":[],"fields":null}`,
		"nullRows": `{"rows":null,"fields":[]}`, "extraEnvelope": `{"rows":[],"fields":[],"ok":true}`,
		"duplicateEnvelope": `{"rows":[],"rows":[],"fields":[]}`, "duplicateField": `{"rows":[],"fields":["id","id"]}`,
		"rowNull": `{"rows":[null],"fields":[]}`, "missingCell": `{"rows":[{}],"fields":["id"]}`,
		"extraCell":     `{"rows":[{"id":1,"other":2}],"fields":["id"]}`,
		"duplicateCell": `{"rows":[{"id":1,"id":2}],"fields":["id"]}`,
		"nonObjectRow":  `{"rows":[[1]],"fields":["id"]}`, "nonStringField": `{"rows":[],"fields":[1]}`,
		"trailing": `{"rows":[],"fields":[]} {}`, "infinite": `{"rows":[{"id":1e999}],"fields":["id"]}`,
		"depth":         `{"rows":[{"id":` + strings.Repeat("[", 20) + "1" + strings.Repeat("]", 20) + `}],"fields":["id"]}`,
		"tooManyRows":   `{"rows":[` + manyRows + `],"fields":["id"]}`,
		"tooManyFields": `{"rows":[],"fields":` + string(fieldJSON) + "}",
		"oversize":      strings.Repeat(" ", pluginDatabaseMaxJSON+1),
		"invalidUTF8":   string([]byte{'{', '"', 'x', '"', ':', '"', 255, '"', '}'}),
	}
	for name, payload := range tests {
		t.Run(name, func(t *testing.T) {
			if rows, fields, err := decodePluginQuery(json.RawMessage(payload)); !errors.Is(err, ErrPluginDatabaseProtocol) || rows != nil || fields != nil {
				t.Fatalf("malformed response accepted: %v", err)
			}
		})
	}
}

func TestPluginDatabaseClientSerializationPreservesNumbers(t *testing.T) {
	payload := json.RawMessage(`{"rows":[{"value":{"large":9007199254740993,"negative":-9007199254740993,"exponent":9.007199254740993e15,"fraction":0.1234567890123456789,"safe":42,"normal":1.25,"nested":[9007199254740992],"tiny":1e-100000}}],"fields":["value"]}`)
	rows, _, err := decodePluginQuery(payload)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	// Ordinary JSON decoding models the JS bridge: unsafe values must be strings.
	var client []map[string]interface{}
	if err := json.Unmarshal(encoded, &client); err != nil {
		t.Fatal(err)
	}
	value := client[0]["value"].(map[string]interface{})
	expected := map[string]string{"large": "9007199254740993", "negative": "-9007199254740993", "exponent": "9.007199254740993e15", "fraction": "0.1234567890123456789", "tiny": "1e-100000"}
	for key, text := range expected {
		if value[key] != text {
			t.Fatalf("client precision lost for %s: %v", key, value[key])
		}
	}
	if value["safe"] != float64(42) || value["normal"] != 1.25 || value["nested"].([]interface{})[0] != "9007199254740992" {
		t.Fatal("recursive numeric policy changed")
	}
}

func TestPluginDatabaseScalarRepliesMustBeExplicit(t *testing.T) {
	for _, payload := range []string{`{}`, `{"ok":false}`, `{"ok":null}`, `{"ok":true,"extra":1}`} {
		if err := decodePluginDatabaseOK(json.RawMessage(payload)); !errors.Is(err, ErrPluginDatabaseProtocol) {
			t.Fatalf("bad ok accepted: %s", payload)
		}
	}
	for _, payload := range []string{`{}`, `{"names":null}`, `{"names":["a","a"]}`, `{"names":[null]}`} {
		if _, err := decodePluginNames(json.RawMessage(payload)); !errors.Is(err, ErrPluginDatabaseProtocol) {
			t.Fatalf("bad names accepted: %s", payload)
		}
	}
	for _, payload := range []string{`{}`, `{"statement":null}`, `{"statement":""}`, `{"statement":1}`} {
		if _, err := decodePluginStatement(json.RawMessage(payload)); !errors.Is(err, ErrPluginDatabaseProtocol) {
			t.Fatalf("bad statement accepted: %s", payload)
		}
	}
	if names, err := decodePluginNames(json.RawMessage(`{"names":[]}`)); err != nil || names == nil {
		t.Fatal("explicit empty catalog rejected")
	}
}
