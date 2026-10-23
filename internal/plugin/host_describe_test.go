package plugin

import (
	"context"
	"strings"
	"testing"
)

func TestHostDescribeReturnsLiveIdentity(t *testing.T) {
	m := testManager(t)
	m.opts.HostVersion = "9.9.9"
	m.opts.Locale = "zh-CN"
	status := installHostLogMode(t, m, "example.hostdescribe", "host-describe", true)
	denied := installHostLogMode(t, m, "example.hostdescribe-denied", "host-describe", false)
	enableFixture(t, m, status.Manifest.ID)
	enableFixture(t, m, denied.Manifest.ID)
	if err := m.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	running := waitState(t, m, status.Manifest.ID, StateRunning)
	waitState(t, m, denied.Manifest.ID, StateRunning)
	body := waitHostLogResponse(t, m, status.Manifest.ID)
	if !strings.Contains(body, `"pluginId":"example.hostdescribe"`) || !strings.Contains(body, `"hostVersion":"9.9.9"`) || !strings.Contains(body, `"locale":"zh-CN"`) || !strings.Contains(body, `"generation":`+itoa(running.Generation)) {
		t.Fatalf("describe %s generation %d", body, running.Generation)
	}
	if deniedBody := waitHostLogResponse(t, m, denied.Manifest.ID); !strings.Contains(deniedBody, `"code":-32003`) {
		t.Fatalf("denied describe %s", deniedBody)
	}
}
