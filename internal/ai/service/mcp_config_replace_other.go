//go:build !windows

package aiservice

import "os"

func replaceMCPConfigFile(source string, target string) error {
	return os.Rename(source, target)
}
