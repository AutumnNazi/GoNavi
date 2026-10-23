package market

import (
	"bytes"
	"fmt"
	"io"
	"path"
	"regexp"
	"slices"
	"unicode/utf8"
)

const (
	maxArtifactSkills     = 16
	maxArtifactSkillBytes = 64 << 10
	artifactSkillFilename = "SKILL.md"
)

var artifactSkillIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,63}$`)

type artifactSkill struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Entry       string   `json:"entry"`
	Resources   []string `json:"resources,omitempty"`
}

// Candidates may precede the manifest in a TGZ stream. Retain only bounded
// validation metadata, never bodies; undeclared documents remain opaque assets.
func (index *artifactIndex) readSkillDocumentCandidate(name string, size int64, reader io.Reader) error {
	contents, err := io.ReadAll(io.LimitReader(reader, maxArtifactSkillBytes+1))
	if err != nil {
		return fmt.Errorf("read skill document candidate: %w", err)
	}
	if int64(len(contents)) != size {
		return fmt.Errorf("skill document size differs from archive header")
	}
	if len(contents) == 0 || len(contents) > maxArtifactSkillBytes || !utf8.Valid(contents) || bytes.IndexByte(contents, 0) >= 0 {
		return nil
	}
	if index.skillDocuments == nil {
		index.skillDocuments = make(map[string]bool)
	}
	index.skillDocuments[name] = true
	return nil
}

func isArtifactMarkdown(name string) bool {
	return path.Ext(name) == ".md"
}

func (index *artifactIndex) validateSkillResources(skill artifactSkill) error {
	if len(skill.Resources) > 4 {
		return fmt.Errorf("too many skill resources")
	}
	seen := map[string]bool{skill.Entry: true}
	for _, resource := range skill.Resources {
		if seen[resource] || path.Ext(resource) != ".md" || path.Base(resource) == artifactSkillFilename || safeArtifactPath(resource) != nil {
			return fmt.Errorf("invalid skill resource")
		}
		if err := index.reference(resource); err != nil {
			return fmt.Errorf("skill resource: %w", err)
		}
		if !index.skillDocuments[resource] {
			return fmt.Errorf("skill resource must contain 1 to %d UTF-8 bytes without NUL", maxArtifactSkillBytes)
		}
		seen[resource] = true
	}
	return nil
}

func (index *artifactIndex) validateSkillContributions(manifest artifactManifest) error {
	skills := manifest.Contributes.Skills
	if len(skills) == 0 {
		return nil
	}
	if len(skills) > maxArtifactSkills {
		return fmt.Errorf("too many skill contributions")
	}
	if !slices.Contains(manifest.Permissions, "ai.skills") {
		return fmt.Errorf("skill contributions require ai.skills permission")
	}
	seen := make(map[string]bool, len(skills))
	for _, skill := range skills {
		if !artifactSkillIDPattern.MatchString(skill.ID) || seen[skill.ID] {
			return fmt.Errorf("invalid or duplicate skill id")
		}
		if !artifactText(skill.Name, 256) || !artifactText(skill.Description, 2048) {
			return fmt.Errorf("invalid skill name or description")
		}
		if err := safeArtifactPath(skill.Entry); err != nil || path.Base(skill.Entry) != artifactSkillFilename {
			return fmt.Errorf("skill entry must be a canonical package-relative SKILL.md path")
		}
		if err := index.reference(skill.Entry); err != nil {
			return fmt.Errorf("skill entry: %w", err)
		}
		if !index.skillDocuments[skill.Entry] {
			return fmt.Errorf("skill document must contain 1 to %d UTF-8 bytes without NUL", maxArtifactSkillBytes)
		}
		if err := index.validateSkillResources(skill); err != nil {
			return err
		}
		seen[skill.ID] = true
	}
	return nil
}
