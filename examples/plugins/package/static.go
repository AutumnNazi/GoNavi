package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"unicode/utf8"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

const maxStaticManifestBytes = 256 << 10

func buildStaticPackage(ctx context.Context, opts options) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	manifestPath, err := filepath.Abs(opts.manifest)
	if err != nil {
		return fmt.Errorf("resolve static manifest: %w", err)
	}
	root := filepath.Dir(manifestPath)
	raw, err := readStaticFile(ctx, root, filepath.Base(manifestPath), maxStaticManifestBytes)
	if err != nil {
		return fmt.Errorf("read static manifest: %w", err)
	}
	if !utf8.Valid(raw) || bytes.IndexByte(raw, 0) >= 0 {
		return fmt.Errorf("static manifest must be UTF-8 without NUL")
	}
	var manifest plugin.Manifest
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&manifest); err != nil || !json.Valid(raw) {
		return fmt.Errorf("invalid static manifest JSON")
	}
	if err = validateStaticManifest(manifest); err != nil {
		return err
	}
	documents, err := collectSkillDocuments(ctx, root, manifest.Contributes.Skills)
	if err != nil {
		return err
	}
	output, err := filepath.Abs(opts.output)
	if err != nil {
		return fmt.Errorf("resolve static output: %w", err)
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	// Validate and snapshot bounded source bytes before creating any output.
	if err = os.Mkdir(output, 0700); err != nil {
		return fmt.Errorf("create new static package directory: %w", err)
	}
	if err = writeCapturedSkills(ctx, output, documents); err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return fmt.Errorf("static package incomplete (partial output retained): %w", err)
	}
	// Publish the manifest last: interrupted output must not look like a complete package.
	if err = writeStaticFile(filepath.Join(output, "gonavi.plugin.json"), raw); err != nil {
		return fmt.Errorf("write static manifest (partial output retained): %w", err)
	}
	if _, err = fmt.Fprintln(os.Stdout, output); err != nil {
		return err
	}
	return nil
}

func validateStaticManifest(manifest plugin.Manifest) error {
	if manifest.Backend != nil || manifest.Window != nil {
		return fmt.Errorf("static mode cannot package a backend or window")
	}
	contributions := manifest.Contributes
	if contributions == nil || len(contributions.Skills) == 0 {
		return fmt.Errorf("static mode requires declared Skills")
	}
	if len(contributions.Commands) != 0 || len(contributions.DataSources) != 0 || len(contributions.Panels) != 0 || len(contributions.AIProviders) != 0 || len(contributions.Exporters) != 0 {
		return fmt.Errorf("static mode supports only Skills contributions")
	}
	return validateSkillDeclarations(manifest)
}
