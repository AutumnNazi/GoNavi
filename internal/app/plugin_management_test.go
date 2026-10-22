package app

import "testing"

func TestPluginManagementAllowed(t *testing.T) {
	t.Setenv("GONAVI_WEB_PLUGIN_MANAGEMENT", "")
	cases := []struct {
		name string
		app  *App
		env  string
		want bool
	}{
		{name: "nil app", app: nil, want: false},
		{name: "desktop session", app: &App{}, want: true},
		{name: "web defaults to read-only", app: &App{webRuntime: true}, want: false},
		{name: "web opt-in with 1", app: &App{webRuntime: true}, env: "1", want: true},
		{name: "web opt-in is case insensitive", app: &App{webRuntime: true}, env: "TRUE", want: true},
		{name: "web opt-in rejects zero", app: &App{webRuntime: true}, env: "0", want: false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Setenv("GONAVI_WEB_PLUGIN_MANAGEMENT", testCase.env)
			if got := testCase.app.pluginManagementAllowed(); got != testCase.want {
				t.Fatalf("pluginManagementAllowed() = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestPluginRuntimeInfoReportsWebRuntime(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	t.Setenv("GONAVI_WEB_PLUGIN_MANAGEMENT", "1")
	result := (&App{webRuntime: true}).PluginRuntimeInfo()
	if !result.Success {
		t.Fatalf("runtime info failed: %+v", result)
	}
	data, ok := result.Data.(map[string]bool)
	if !ok {
		t.Fatalf("runtime info data = %T", result.Data)
	}
	if !data["managementAllowed"] || !data["webRuntime"] || data["safeMode"] {
		t.Fatalf("runtime info = %#v", data)
	}
}
