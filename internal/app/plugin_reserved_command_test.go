package app

import "testing"

import "GoNavi-Wails/internal/plugin"

func TestPluginReservedCommandsUseSpecificError(t *testing.T) {
	a := newPluginTestApp(t)
	for _, err := range []error{plugin.ErrDataSourceCommandReserved, plugin.ErrAIProviderCommandReserved, plugin.ErrExporterCommandReserved} {
		result := a.pluginResult(nil, err)
		code, _ := result.Data.(map[string]any)["code"].(string)
		if result.Success || code != "command_reserved" || result.Message == "" {
			t.Fatalf("%v: %+v", err, result)
		}
	}
}
