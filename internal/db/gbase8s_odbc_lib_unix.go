//go:build (gonavi_full_drivers || gonavi_gbase8s_driver) && !windows

package db

import "github.com/ebitengine/purego"

// odbcLibrary 是用 dlopen 打开的 CSDK ODBC 驱动库（不经过 unixODBC 驱动管理器，CGO_ENABLED=0 也能用）。
type odbcLibrary struct {
	handle uintptr
}

func loadODBCLibrary(path string) (odbcLibrary, error) {
	handle, err := purego.Dlopen(path, purego.RTLD_NOW|purego.RTLD_GLOBAL)
	if err != nil {
		return odbcLibrary{}, err
	}
	return odbcLibrary{handle: handle}, nil
}

func (l odbcLibrary) symbol(name string) (uintptr, error) {
	return purego.Dlsym(l.handle, name)
}
