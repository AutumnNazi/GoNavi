//go:build !windows

package plugin

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"syscall"
)

func processAlive(pid int) bool {
	if runtime.GOOS == "linux" {
		content, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
		if err == nil {
			end := strings.LastIndexByte(string(content), ')')
			if end >= 0 && strings.HasPrefix(string(content)[end+1:], " Z") {
				return false
			}
		}
	}
	return syscall.Kill(pid, 0) == nil
}
