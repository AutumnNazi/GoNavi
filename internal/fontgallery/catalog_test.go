package fontgallery

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
)

func fixtureEntry(payload []byte) Entry {
	sum := sha256.Sum256(payload)
	hash := hex.EncodeToString(sum[:])
	font := Asset{Path: "assets/" + hash + ".ttf", SHA256: hash, SizeBytes: int64(len(payload)), MIMEType: "font/ttf"}
	return Entry{
		ID: "go-mono", Version: "1", Kind: "mono", Family: "Go Mono",
		Names:       map[string]string{"en-US": "Go Mono", "zh-CN": "Go Mono"},
		Description: "Synthetic fixture programming font", UseCase: "SQL editor",
		Font: font, Preview: font, Attribution: "Go Authors",
		SourceURL: "https://example.com/source", RightsStatus: "approved",
		License: License{ID: "bsd", Name: "BSD", URL: "https://example.com/license", Notice: "Synthetic fixture", Text: "Permission notice", NonCommercial: false},
	}
}

func TestParseCatalogRejectsUnknownFieldsAndDuplicates(t *testing.T) {
	if _, err := parseCatalog([]byte("{\"schemaVersion\":1,\"version\":\"1\",\"entries\":[]}")); err != nil {
		t.Fatal(err)
	}
	if _, err := parseCatalog([]byte("{\"schemaVersion\":1,\"version\":\"1\",\"entries\":[],\"extra\":true}")); err == nil {
		t.Fatal("unknown fields must fail")
	}
	entry := fixtureEntry([]byte("not-a-font"))
	payload, err := json.Marshal(Catalog{SchemaVersion: 1, Version: "1", Entries: []Entry{entry, entry}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := parseCatalog(payload); err == nil {
		t.Fatal("duplicate ids must fail")
	}
}

func TestEmptyCatalogIsValid(t *testing.T) {
	catalog, err := parseCatalog([]byte("{\"schemaVersion\":1,\"version\":\"1\",\"entries\":[]}"))
	if err != nil || catalog == nil || len(catalog.Entries) != 0 {
		t.Fatalf("empty catalog should be valid: %+v %v", catalog, err)
	}
}
