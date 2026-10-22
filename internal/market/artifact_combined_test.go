package market

import (
	"context"
	"encoding/json"
	"testing"
)

const combinedContributionManifest = `{"schemaVersion":1,"apiVersion":1,"id":"example.bundle","name":"Bundle","version":"1.0.0","permissions":["data.sources","ai.skills","ai.providers","data.export"],"backend":{"platforms":{"windows/amd64":{"executable":"bin/plugin","runtime":"native"},"linux/amd64":{"executable":"bin/plugin"}}},"contributes":{"commands":[{"id":"db","title":"DB"},{"id":"chat","title":"Chat"},{"id":"render","title":"Render"}],"dataSources":[{"id":"db","name":"DB","dialect":"sqlite","command":"db","readOnly":true}],"skills":[{"id":"guide","name":"Guide","description":"Read","entry":"skills/guide/SKILL.md","resources":["skills/guide/NOTES.md"]}],"aiProviders":[{"id":"chat","name":"Chat","command":"chat","models":[{"id":"model-a","name":"Model","contextWindow":4096,"maxOutputTokens":512}],"supportsTools":true,"supportsImages":false}],"exporters":[{"id":"ndjson","name":"NDJSON","command":"render","extension":"ndjson","contentType":"application/x-ndjson"}]}}`

func TestCombinedContributionArchive(t *testing.T) {
	entries := append(artifactTestEntries(combinedContributionManifest),
		artifactTestEntry{name: "skills/guide/SKILL.md", body: []byte("guide")},
		artifactTestEntry{name: "skills/guide/NOTES.md", body: []byte("notes")},
	)
	filename := artifactTestWrite(t, ".zip", artifactTestArchive(t, ".zip", entries))
	validated, err := ValidatePackage(context.Background(), filename)
	if err != nil || validated.ID != "example.bundle" {
		t.Fatalf("%+v %v", validated, err)
	}
	var decoded map[string]any
	if err = json.Unmarshal([]byte(combinedContributionManifest), &decoded); err != nil {
		t.Fatal(err)
	}
	providers := decoded["contributes"].(map[string]any)["aiProviders"].([]any)
	providers[0].(map[string]any)["supportsImages"] = true
	raw, err := json.Marshal(decoded)
	if err != nil {
		t.Fatal(err)
	}
	imageEntries := append(artifactTestEntries(string(raw)),
		artifactTestEntry{name: "skills/guide/SKILL.md", body: []byte("guide")},
		artifactTestEntry{name: "skills/guide/NOTES.md", body: []byte("notes")},
	)
	image := artifactTestWrite(t, ".zip", artifactTestArchive(t, ".zip", imageEntries))
	if _, err = ValidatePackage(context.Background(), image); err != nil {
		t.Fatalf("image provider was rejected: %v", err)
	}
}
