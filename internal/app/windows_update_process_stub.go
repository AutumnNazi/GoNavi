//go:build !windows

package app

func findOtherWindowsUpdateInstances(_ []string, _ int) ([]windowsUpdateProcess, error) {
	return nil, nil
}

func closeWindowsUpdateInstances(_ []windowsUpdateProcess) error {
	return nil
}
