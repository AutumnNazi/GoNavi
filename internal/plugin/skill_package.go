package plugin

import "fmt"

func (s *packageScan) recordSkillFile(name string, size int64, content []byte) {
	if s.skillFiles == nil {
		s.skillFiles = make(map[string]error)
	}
	var err error
	if size > maxSkillBytes {
		err = fmt.Errorf("skill document exceeds size limit")
	} else {
		err = validateSkillContent(content)
	}
	s.skillFiles[name] = err
	if name == s.captureSkill && err == nil {
		// These are the same chunks sent to the file hash, never a second path-based read.
		s.skillContent = append([]byte(nil), content...)
	}
}

func (s *packageScan) validateSkillEntries(manifest Manifest) error {
	for _, skill := range manifest.Contributes.Skills {
		err, exists := s.skillFiles[skill.Entry]
		if !exists {
			return fmt.Errorf("declared skill entry is not a regular package file")
		}
		if err != nil {
			return fmt.Errorf("invalid declared skill document: %w", err)
		}
		for _, resource := range skill.Resources {
			err, exists = s.skillFiles[resource]
			if !exists {
				return fmt.Errorf("declared skill resource is not a regular package file")
			}
			if err != nil {
				return fmt.Errorf("invalid declared skill resource: %w", err)
			}
		}
	}
	return nil
}
