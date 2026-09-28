package main

import (
	"os"
	"strconv"
	"time"

	"golang.org/x/sys/windows"
)

func main() {
	if len(os.Args) == 3 && os.Args[1] == "--gonavi-clean-update-dir" {
		pid, err := strconv.Atoi(os.Args[2])
		if err != nil || pid <= 4 {
			return
		}
		handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
		if err == nil {
			_, _ = windows.WaitForSingleObject(handle, windows.INFINITE)
			_ = windows.CloseHandle(handle)
		}
		for attempt := 0; attempt < 20; attempt++ {
			if os.RemoveAll(os.Getenv("GONAVI_UPDATE_ROOT_DIR")) == nil {
				return
			}
			time.Sleep(250 * time.Millisecond)
		}
		return
	}
	time.Sleep(6 * time.Second)
}
