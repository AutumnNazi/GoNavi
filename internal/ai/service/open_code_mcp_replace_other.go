//go:build !windows

package aiservice

import "os"

func replaceOpenCodeConfigFile(source string, target string) error {
	return os.Rename(source, target)
}
