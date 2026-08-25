package app

import "GoNavi-Wails/internal/connection"

func (a *App) connectionSidebarLayoutRepository() *connectionSidebarLayoutRepository {
	return newConnectionSidebarLayoutRepository(a.configDir)
}

// BootstrapConnectionSidebarLayout returns the shared backend layout when it
// exists. Otherwise, only a candidate containing at least one host group may
// initialize it; an empty-group client must not block another Bundle ID from
// migrating its richer legacy LocalStorage state later.
func (a *App) BootstrapConnectionSidebarLayout(
	candidate connection.ConnectionSidebarLayoutInput,
) (connection.ConnectionSidebarLayout, error) {
	result, mutated, err := a.connectionSidebarLayoutRepository().Bootstrap(candidate)
	if err != nil {
		return result, err
	}
	if mutated {
		a.markCloudBackupDirty()
	}
	return result, nil
}

// SaveConnectionSidebarLayout replaces the complete shared layout using an
// optimistic revision check. A conflict is returned as data together with the
// current authoritative layout so the caller can recover without parsing an
// error string.
func (a *App) SaveConnectionSidebarLayout(
	input connection.SaveConnectionSidebarLayoutInput,
) (connection.SaveConnectionSidebarLayoutResult, error) {
	result, err := a.connectionSidebarLayoutRepository().Save(input)
	if err != nil || result.Conflict {
		return result, err
	}
	a.markCloudBackupDirty()
	return result, nil
}
