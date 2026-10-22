package cli

import (
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInvokeSurfacesReservedDataSourceCommand(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	for _, reserved := range []error{plugin.ErrDataSourceCommandReserved, plugin.ErrAIProviderCommandReserved, plugin.ErrExporterCommandReserved} {
		fake := &fakePluginRuntime{
			statuses:  []plugin.Status{{Manifest: plugin.Manifest{ID: "example.source"}, DesiredEnabled: true, State: plugin.StateRunning}},
			invokeErr: reserved,
		}
		code, stdout, stderr, _ := testPluginCLI(t, []string{"invoke", "example.source", "database"}, fake)
		if code == ExitSuccess || fake.invoked != "database" || !strings.Contains(stderr, reserved.Error()) || strings.Contains(stderr, "example.source") {
			t.Fatalf("reserved invoke: exit=%d command=%s stdout=%s stderr=%s", code, fake.invoked, stdout, stderr)
		}
	}
}
