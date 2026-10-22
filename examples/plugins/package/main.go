// Command package builds native examples or copies explicitly selected static Skills packages.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

type options struct {
	source, manifest, output, goos, goarch string
	static                                 bool
}

func main() {
	var opts options
	flag.StringVar(&opts.source, "source", "./hello", "Go package directory (native mode only)")
	flag.BoolVar(&opts.static, "static", false, "copy a backend-free Skills package without compiling or executing code")
	flag.StringVar(&opts.manifest, "manifest", "./hello/gonavi.plugin.json", "manifest template")
	flag.StringVar(&opts.output, "output", "", "new package directory (must not exist)")
	flag.StringVar(&opts.goos, "goos", runtime.GOOS, "target GOOS (native mode only)")
	flag.StringVar(&opts.goarch, "goarch", runtime.GOARCH, "target GOARCH (native mode only)")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := buildPackage(ctx, opts); err != nil {
		err = publicPackageError(err, opts.manifest, filepath.Dir(opts.manifest), opts.output, opts.source)
		if _, writeErr := fmt.Fprintln(os.Stderr, err); writeErr != nil {
			os.Exit(2)
		}
		os.Exit(1)
	}
}

func buildPackage(ctx context.Context, opts options) error {
	if opts.output == "" {
		return fmt.Errorf("output directory is required")
	}
	if opts.static {
		return buildStaticPackage(ctx, opts)
	}
	output, err := filepath.Abs(opts.output)
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(opts.manifest)
	if err != nil {
		return fmt.Errorf("read manifest template: %w", err)
	}
	var manifest plugin.Manifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return fmt.Errorf("decode manifest template: %w", err)
	}
	if manifest.Backend == nil || manifest.Backend.Default == nil {
		return fmt.Errorf("template requires a default backend")
	}
	executable := "bin/plugin"
	if opts.goos == "windows" {
		executable += ".exe"
	}
	documents, err := prepareNativeSkills(ctx, opts.manifest, manifest, executable)
	if err != nil {
		return fmt.Errorf("validate native package Skills before compilation: %w", err)
	}
	// Refuse replacement of an existing directory or user-selected file.
	if err := os.Mkdir(output, 0700); err != nil {
		return fmt.Errorf("create new package directory: %w", err)
	}
	if err := os.Mkdir(filepath.Join(output, "bin"), 0700); err != nil {
		return err
	}
	if err := writeCapturedSkills(ctx, output, documents); err != nil {
		return err
	}
	entry := *manifest.Backend.Default
	entry.Executable = executable
	manifest.Backend = &plugin.Backend{Platforms: map[string]plugin.Entry{opts.goos + "/" + opts.goarch: entry}}
	command := exec.CommandContext(ctx, "go", "build", "-trimpath", "-o", filepath.Join(output, filepath.FromSlash(executable)), ".")
	command.Dir = opts.source
	command.Env = append(os.Environ(), "GOWORK=off", "GOPROXY=off", "GOSUMDB=off", "CGO_ENABLED=0", "GOOS="+opts.goos, "GOARCH="+opts.goarch)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("build plugin (partial output retained): %w", err)
	}
	encoded, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(output, "gonavi.plugin.json"), append(encoded, '\n'), 0600); err != nil {
		return err
	}
	if _, err := fmt.Fprintln(os.Stdout, output); err != nil {
		return err
	}
	return nil
}
