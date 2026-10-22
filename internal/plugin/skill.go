package plugin

import (
	"bytes"
	"fmt"
	"path"
	"regexp"
	"strings"
	"unicode/utf8"
)

const maxSkills = 16
const maxSkillBytes = 64 << 10
const maxSkillResources = 4

var skillIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,63}$`)

// Skill declares an immutable, explicitly loaded document. It grants no tools or hooks.
type Skill struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Entry       string   `json:"entry"`
	Resources   []string `json:"resources,omitempty"`
}

// SkillContent is authenticated packaged text with its exact lifecycle provenance.
// It is a tool-result resource, never an automatically injected system instruction.
type SkillContent struct {
	PluginID    string `json:"pluginId"`
	SkillID     string `json:"skillId"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Version     string `json:"version"`
	Digest      string `json:"digest"`
	Generation  uint64 `json:"generation"`
	Content     string `json:"content"`
	Resource    string `json:"resource,omitempty"`
}

func validateSkills(manifest Manifest) error {
	skills := manifest.Contributes.Skills
	if len(skills) == 0 {
		return nil
	}
	if len(skills) > maxSkills {
		return fmt.Errorf("too many skill contributions")
	}
	if !hasSkillPermission(manifest) {
		return fmt.Errorf("skill contributions require ai.skills permission")
	}
	ids := make(map[string]bool, len(skills))
	for _, skill := range skills {
		if !skillIDPattern.MatchString(skill.ID) || ids[skill.ID] {
			return fmt.Errorf("invalid or duplicate skill id")
		}
		if !validSkillText(skill.Name, 256) || !validSkillText(skill.Description, 2048) {
			return fmt.Errorf("invalid skill metadata")
		}
		if !utf8.ValidString(skill.Entry) || path.Base(skill.Entry) != "SKILL.md" {
			return fmt.Errorf("skill entry must name an exact SKILL.md file")
		}
		if err := safePackagePath(skill.Entry); err != nil {
			return fmt.Errorf("invalid skill entry: %w", err)
		}
		if err := validateSkillResources(skill); err != nil {
			return err
		}
		ids[skill.ID] = true
	}
	return nil
}

func sameSkill(left, right Skill) bool {
	if left.ID != right.ID || left.Name != right.Name || left.Description != right.Description || left.Entry != right.Entry || len(left.Resources) != len(right.Resources) {
		return false
	}
	for i := range left.Resources {
		if left.Resources[i] != right.Resources[i] {
			return false
		}
	}
	return true
}

func isSkillDocument(name string) bool {
	return path.Ext(name) == ".md"
}

func validateSkillResources(skill Skill) error {
	if len(skill.Resources) > maxSkillResources {
		return fmt.Errorf("too many skill resources")
	}
	seen := map[string]bool{skill.Entry: true}
	for _, resource := range skill.Resources {
		if seen[resource] || path.Ext(resource) != ".md" || path.Base(resource) == "SKILL.md" || safePackagePath(resource) != nil {
			return fmt.Errorf("invalid skill resource")
		}
		seen[resource] = true
	}
	return nil
}

func validSkillText(value string, limit int) bool {
	return utf8.ValidString(value) && len(value) <= limit && strings.TrimSpace(value) != "" && !strings.ContainsRune(value, 0)
}

func hasSkillPermission(manifest Manifest) bool {
	for _, permission := range manifest.Permissions {
		if permission == "ai.skills" {
			return true
		}
	}
	return false
}

func validateSkillContent(value []byte) error {
	if len(value) == 0 || len(value) > maxSkillBytes {
		return fmt.Errorf("skill document is empty or exceeds size limit")
	}
	if !utf8.Valid(value) || bytes.IndexByte(value, 0) >= 0 {
		return fmt.Errorf("skill document must be UTF-8 text without NUL")
	}
	return nil
}
