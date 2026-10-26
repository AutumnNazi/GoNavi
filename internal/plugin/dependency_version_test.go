package plugin

import "testing"

func TestDependencyVersionBounds(t *testing.T) {
	manifest := basicManifest("example.host")
	manifest.Version = "1.2.3-rc.1+build.007"
	manifest.Requires = []Dependency{{ID: "example.other", MinVersion: "1.2.3"}}
	if err := ValidateManifest(manifest); err != nil {
		t.Fatal(err)
	}
	for _, version := range []string{"1.2", "v1.2.3", "01.2.3", "1.2.3-01", "1.2.3-", "1.2.3+"} {
		manifest.Version = version
		manifest.Requires = nil
		if ValidateManifest(manifest) == nil {
			t.Fatalf("accepted version %s", version)
		}
		manifest.Version = "1.0.0"
		manifest.Requires = []Dependency{{ID: "example.other", MinVersion: version}}
		if ValidateManifest(manifest) == nil {
			t.Fatalf("accepted minimum %s", version)
		}
	}
}
