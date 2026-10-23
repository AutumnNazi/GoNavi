package plugin

import (
	"fmt"
	"testing"
)

func TestDependencyCountBound(t *testing.T) {
	manifest := basicManifest("example.host")
	for i := 0; i < 64; i++ {
		manifest.Requires = append(manifest.Requires, Dependency{ID: fmt.Sprintf("example.dep%d", i)})
	}
	if err := ValidateManifest(manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Requires = append(manifest.Requires, Dependency{ID: "example.extra"})
	if ValidateManifest(manifest) == nil {
		t.Fatal("65 dependencies were accepted")
	}
}
