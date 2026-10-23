package main

import (
	"fmt"
	"path"
	"regexp"
	"strings"
)

var staticSkillID = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,63}$`)

func validateStaticSkillEntry(entry string) error {
	if err := safeStaticPath(entry); err != nil {
		return err
	}
	if path.Base(entry) != "SKILL.md" {
		return fmt.Errorf("static Skill entry must end in exact SKILL.md")
	}
	return nil
}

func validateStaticSkillResources(entry string, resources []string) error {
	if len(resources) > 4 {
		return fmt.Errorf("too many static Skill resources")
	}
	seen := map[string]bool{entry: true}
	for _, resource := range resources {
		if seen[resource] || path.Ext(resource) != ".md" || path.Base(resource) == "SKILL.md" || safeStaticPath(resource) != nil {
			return fmt.Errorf("static Skill resource must be a markdown file other than SKILL.md")
		}
		seen[resource] = true
	}
	return nil
}

func safeStaticPath(entry string) error {
	if entry == "" || len(entry) > 1024 || strings.Count(entry, "/") > 32 || strings.ContainsAny(entry, "\\:\x00<>\"|?*") || path.IsAbs(entry) || path.Clean(entry) != entry {
		return fmt.Errorf("unsafe static package path")
	}
	for _, char := range entry {
		if char < 32 {
			return fmt.Errorf("control character in static package path")
		}
	}
	for _, part := range strings.Split(entry, "/") {
		if part == "." || part == ".." || len(part) > 240 || strings.TrimRight(part, " .") != part {
			return fmt.Errorf("ambiguous static package path component")
		}
		base := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
		if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || base == "CLOCK$" || base == "CONIN$" || base == "CONOUT$" || staticReservedPort(base) {
			return fmt.Errorf("reserved static package path component")
		}
	}
	return nil
}

func staticReservedPort(base string) bool {
	if !strings.HasPrefix(base, "COM") && !strings.HasPrefix(base, "LPT") {
		return false
	}
	suffix := base[3:]
	return len(suffix) == 1 && suffix[0] >= '0' && suffix[0] <= '9' || suffix == "¹" || suffix == "²" || suffix == "³"
}

func registerStaticEntry(entry string, paths map[string]string, files map[string]bool) error {
	parts := strings.Split(entry, "/")
	for index := range parts {
		prefix := strings.Join(parts[:index+1], "/")
		key := strings.ToLower(prefix)
		if previous, exists := paths[key]; exists && previous != prefix {
			return fmt.Errorf("case-colliding static package paths")
		}
		if files[key] && index < len(parts)-1 {
			return fmt.Errorf("static file and directory path conflict")
		}
		if index == len(parts)-1 {
			if _, exists := paths[key]; exists && !files[key] {
				return fmt.Errorf("static file overwrites a directory")
			}
			files[key] = true
		}
		paths[key] = prefix
	}
	return nil
}
