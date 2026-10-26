package app

import (
	"testing"

	"GoNavi-Wails/internal/plugin"
)

// A generic operation_failed hides what the user has to do next. Lifecycle sentinels keep their code.
func TestPluginResultKeepsLifecycleCodesSpecific(t *testing.T) {
	a := newPluginTestApp(t)
	for _, test := range []struct {
		name string
		err  error
		code string
	}{
		{name: "disabled", err: plugin.ErrDisabled, code: "plugin_disabled"},
		{name: "digest", err: plugin.ErrDigestMismatch, code: "digest_mismatch"},
		{name: "missing", err: plugin.ErrNotFound, code: "not_found"},
		{name: "busy", err: plugin.ErrBusy, code: "plugin_busy"},
	} {
		t.Run(test.name, func(t *testing.T) {
			result := a.pluginResult(nil, test.err)
			if result.Success {
				t.Fatal("failure reported as success")
			}
			data, ok := result.Data.(map[string]any)
			if !ok || data["code"] != test.code {
				t.Fatalf("code=%v want %s", result.Data, test.code)
			}
			generic := a.pluginFailure("operation_failed")
			if result.Message == "" || result.Message == generic.Message {
				t.Fatalf("message fell back to the generic one: %q", result.Message)
			}
		})
	}
	// An unrelated error must still collapse to the generic code.
	if data, _ := a.pluginResult(nil, plugin.ErrClosed).Data.(map[string]any); data["code"] != "operation_failed" {
		t.Fatalf("unexpected code %v", data["code"])
	}
}
