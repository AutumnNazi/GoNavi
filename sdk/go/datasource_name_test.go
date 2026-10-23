package plugin

import (
	"strings"
	"testing"
)

func TestDataSourceNameByteBounds(t *testing.T) {
	source := DataSource{ID: "fixture", Name: strings.Repeat("中", 85), Dialect: "sqlite", ReadOnly: true}
	if err := ValidateDataSource(source); err != nil {
		t.Fatal(err)
	}
	source.Name = strings.Repeat("中", 86)
	if ValidateDataSource(source) == nil {
		t.Fatal("data source name over 256 bytes was accepted")
	}
}
