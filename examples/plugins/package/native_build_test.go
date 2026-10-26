package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func TestNativeBuildProducesDeclaredPlatformEntry(t *testing.T) {
	output := filepath.Join(t.TempDir(), "package")
	err := buildPackage(context.Background(), options{
		source:   filepath.Join("..", "hello"),
		manifest: filepath.Join("..", "hello", "gonavi.plugin.json"),
		output:   output,
		goos:     runtime.GOOS,
		goarch:   runtime.GOARCH,
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(output, "gonavi.plugin.json"))
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := plugin.ParseManifest(raw)
	if err != nil || manifest.Backend == nil || manifest.Backend.Default != nil {
		t.Fatalf("%v %+v", err, manifest.Backend)
	}
	platform := runtime.GOOS + "/" + runtime.GOARCH
	entry, ok := manifest.Backend.Platforms[platform]
	if !ok || entry.Executable != "bin/plugin"+map[bool]string{true: ".exe"}[runtime.GOOS == "windows"] {
		t.Fatalf("%s: %+v", platform, manifest.Backend.Platforms)
	}
	info, err := os.Stat(filepath.Join(output, filepath.FromSlash(entry.Executable)))
	if err != nil || info.Size() == 0 {
		t.Fatal(err)
	}
	if _, err = json.Marshal(manifest); err != nil {
		t.Fatal(err)
	}
}
