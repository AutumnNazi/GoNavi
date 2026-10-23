package plugin

import (
	"fmt"
	"strings"
)

func reservedPort(base string) bool {
	if !strings.HasPrefix(base, "COM") && !strings.HasPrefix(base, "LPT") {
		return false
	}
	suffix := base[3:]
	return len(suffix) == 1 && suffix[0] >= '0' && suffix[0] <= '9' || suffix == "¹" || suffix == "²" || suffix == "³"
}

func (s *packageScan) registerPath(name string, directory bool) error {
	if s.pathCase == nil {
		s.pathCase = make(map[string]string)
		s.filePaths = make(map[string]bool)
	}
	parts := strings.Split(name, "/")
	for i := range parts {
		prefix := strings.Join(parts[:i+1], "/")
		key := strings.ToLower(prefix)
		if previous, exists := s.pathCase[key]; exists && previous != prefix {
			return fmt.Errorf("case-colliding package directory")
		}
		if s.filePaths[key] && (i < len(parts)-1 || directory) {
			return fmt.Errorf("file and directory package path conflict")
		}
		if i == len(parts)-1 && !directory {
			if _, exists := s.pathCase[key]; exists && !s.filePaths[key] {
				return fmt.Errorf("file overwrites package directory")
			}
			s.filePaths[key] = true
		}
		if _, exists := s.pathCase[key]; !exists && len(s.pathCase) >= maxPackageEntries {
			return fmt.Errorf("package has too many implicit directories")
		}
		s.pathCase[key] = prefix
	}
	return nil
}
