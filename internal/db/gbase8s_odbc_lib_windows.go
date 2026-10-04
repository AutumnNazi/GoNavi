//go:build (gonavi_full_drivers || gonavi_gbase8s_driver) && windows

package db

import "golang.org/x/sys/windows"

// odbcLibrary 是 CSDK 的 ODBC 驱动 DLL；按 DLL 所在目录解析它依赖的其他 CSDK DLL。
type odbcLibrary struct {
	handle windows.Handle
}

func loadODBCLibrary(path string) (odbcLibrary, error) {
	handle, err := windows.LoadLibraryEx(path, 0, windows.LOAD_WITH_ALTERED_SEARCH_PATH)
	if err != nil {
		return odbcLibrary{}, err
	}
	return odbcLibrary{handle: handle}, nil
}

func (l odbcLibrary) symbol(name string) (uintptr, error) {
	return windows.GetProcAddress(l.handle, name)
}
