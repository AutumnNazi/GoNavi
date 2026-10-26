package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

const maxStaticSkillBytes = 64 << 10

type skillDocument struct {
	entry   string
	content []byte
}

func validateSkillDeclarations(manifest plugin.Manifest) error {
	if manifest.SchemaVersion != 1 || manifest.APIVersion != 1 {
		return fmt.Errorf("Skills require manifest and API version 1")
	}
	contributions := manifest.Contributes
	if contributions == nil || len(contributions.Skills) == 0 || len(contributions.Skills) > 16 {
		return fmt.Errorf("package requires 1 to 16 declared Skills")
	}
	permitted := false
	for _, permission := range manifest.Permissions {
		if permission == "ai.skills" {
			permitted = true
		}
	}
	if !permitted {
		return fmt.Errorf("packaged Skills require explicit ai.skills permission")
	}
	ids := make(map[string]bool, len(contributions.Skills))
	for _, skill := range contributions.Skills {
		if !staticSkillID.MatchString(skill.ID) || ids[skill.ID] {
			return fmt.Errorf("invalid or duplicate Skill ID")
		}
		ids[skill.ID] = true
		if err := plugin.ValidateSkillMetadata(skill); err != nil {
			return err
		}
		if err := validateStaticSkillEntry(skill.Entry); err != nil {
			return err
		}
		if err := validateStaticSkillResources(skill.Entry, skill.Resources); err != nil {
			return err
		}
	}
	return nil
}

func prepareNativeSkills(ctx context.Context, manifestPath string, manifest plugin.Manifest, executable string) ([]skillDocument, error) {
	if manifest.Contributes == nil || len(manifest.Contributes.Skills) == 0 {
		return nil, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := validateSkillDeclarations(manifest); err != nil {
		return nil, err
	}
	absolute, err := filepath.Abs(manifestPath)
	if err != nil {
		return nil, err
	}
	return collectSkillDocuments(ctx, filepath.Dir(absolute), manifest.Contributes.Skills, executable)
}

func collectSkillDocuments(ctx context.Context, root string, skills []plugin.Skill, reserved ...string) ([]skillDocument, error) {
	paths := map[string]string{"gonavi.plugin.json": "gonavi.plugin.json"}
	files := map[string]bool{"gonavi.plugin.json": true}
	for _, entry := range reserved {
		if err := registerStaticEntry(entry, paths, files); err != nil {
			return nil, err
		}
	}
	contents := make(map[string][]byte, len(skills))
	for _, skill := range skills {
		for _, entry := range append([]string{skill.Entry}, skill.Resources...) {
			if err := registerStaticEntry(entry, paths, files); err != nil {
				return nil, err
			}
			if _, exists := contents[entry]; exists {
				continue
			}
			body, err := readStaticFile(ctx, root, entry, maxStaticSkillBytes)
			if err != nil {
				return nil, fmt.Errorf("read declared Skill document: %w", err)
			}
			if err = plugin.ValidateSkillDocument(body); err != nil {
				return nil, err
			}
			contents[entry] = body
		}
	}
	names := make([]string, 0, len(contents))
	for entry := range contents {
		names = append(names, entry)
	}
	sort.Strings(names)
	documents := make([]skillDocument, 0, len(names))
	for _, entry := range names {
		documents = append(documents, skillDocument{entry: entry, content: contents[entry]})
	}
	return documents, nil
}

func writeCapturedSkills(ctx context.Context, output string, documents []skillDocument) error {
	for _, document := range documents {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("package incomplete (partial output retained): %w", err)
		}
		target := filepath.Join(output, filepath.FromSlash(document.entry))
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return fmt.Errorf("create Skill directory (partial output retained): %w", err)
		}
		if err := writeStaticFile(target, document.content); err != nil {
			return fmt.Errorf("write Skill document (partial output retained): %w", err)
		}
	}
	return nil
}
