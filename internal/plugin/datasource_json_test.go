package plugin

import (
	"encoding/json"
	"strings"
	"testing"
)

const validDataSourceJSON = `{"id":"fixture","name":"Fixture","dialect":"sqlite","command":"database","readOnly":true}`

func sourceManifestJSON(t *testing.T, source string) []byte {
	t.Helper()
	manifest := dataSourceManifest()
	content, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]json.RawMessage
	if err = json.Unmarshal(content, &object); err != nil {
		t.Fatal(err)
	}
	var contributions map[string]json.RawMessage
	if err = json.Unmarshal(object["contributes"], &contributions); err != nil {
		t.Fatal(err)
	}
	contributions["dataSources"] = json.RawMessage("[" + source + "]")
	object["contributes"], err = json.Marshal(contributions)
	if err != nil {
		t.Fatal(err)
	}
	content, err = json.Marshal(object)
	if err != nil {
		t.Fatal(err)
	}
	return content
}

func TestDataSourceStrictJSON(t *testing.T) {
	cases := map[string]string{
		"missing readonly":   strings.Replace(validDataSourceJSON, `,"readOnly":true`, "", 1),
		"null readonly":      strings.Replace(validDataSourceJSON, `"readOnly":true`, `"readOnly":null`, 1),
		"number readonly":    strings.Replace(validDataSourceJSON, `"readOnly":true`, `"readOnly":1`, 1),
		"string readonly":    strings.Replace(validDataSourceJSON, `"readOnly":true`, `"readOnly":"true"`, 1),
		"case alias":         strings.Replace(validDataSourceJSON, `"readOnly":true`, `"ReadOnly":true`, 1),
		"duplicate readonly": strings.Replace(validDataSourceJSON, `"readOnly":true`, `"readOnly":false,"readOnly":true`, 1),
		"escaped duplicate":  strings.Replace(validDataSourceJSON, `"readOnly":true`, `"readOnly":false,"read\u004fnly":true`, 1),
		"missing id":         strings.Replace(validDataSourceJSON, `"id":"fixture",`, "", 1),
		"missing name":       strings.Replace(validDataSourceJSON, `"name":"Fixture",`, "", 1),
		"missing dialect":    strings.Replace(validDataSourceJSON, `"dialect":"sqlite",`, "", 1),
		"missing command":    strings.Replace(validDataSourceJSON, `"command":"database",`, "", 1),
		"null name":          strings.Replace(validDataSourceJSON, `"name":"Fixture"`, `"name":null`, 1),
		"null port":          strings.Replace(validDataSourceJSON, `"readOnly":true`, `"readOnly":true,"defaultPort":null`, 1),
		"fractional port":    strings.Replace(validDataSourceJSON, `"readOnly":true`, `"readOnly":true,"defaultPort":1.5`, 1),
		"string port":        strings.Replace(validDataSourceJSON, `"readOnly":true`, `"readOnly":true,"defaultPort":"3306"`, 1),
		"unknown capability": strings.Replace(validDataSourceJSON, `"readOnly":true`, `"readOnly":true,"transactions":true`, 1),
		"null declaration":   "null", "array declaration": "[]", "string declaration": `"driver"`,
	}
	for name, source := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseManifest(sourceManifestJSON(t, source)); err == nil {
				t.Fatal("ambiguous or unsupported data source accepted")
			}
		})
	}
	if _, err := ParseManifest(sourceManifestJSON(t, validDataSourceJSON)); err != nil {
		t.Fatalf("valid readonly declaration rejected: %v", err)
	}
	writable := strings.Replace(validDataSourceJSON, `"readOnly":true`, `"readOnly":false`, 1)
	manifest, err := ParseManifest(sourceManifestJSON(t, writable))
	if err != nil || len(manifest.Contributes.DataSources) != 1 || manifest.Contributes.DataSources[0].ReadOnly {
		t.Fatalf("explicit writable declaration rejected or misread: %v %#v", err, manifest.Contributes.DataSources)
	}
}

func TestDataSourceJSONFailureDoesNotMutateReceiver(t *testing.T) {
	source := DataSource{ID: "original", Name: "Original", Dialect: "mysql", Command: "database", DefaultPort: 3306, ReadOnly: true}
	original := source
	if err := json.Unmarshal([]byte(`{"id":"changed","name":"Changed","dialect":"sqlite","command":"database","readOnly":null}`), &source); err == nil {
		t.Fatal("writable declaration accepted")
	}
	if source != original {
		t.Fatal("failed JSON decode partially mutated declaration")
	}
}
