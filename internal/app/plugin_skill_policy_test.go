package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/plugin"
)

func TestPluginSkillSafeModeRevokesExistingOwnerAccess(t *testing.T) {
	fixture := newPluginSkillFixture(t)
	status := startPluginSkillFixture(t, fixture)
	t.Setenv("GONAVI_DISABLE_PLUGINS", "1")
	catalog := pluginSkillCatalogResult(t, fixture.app.PluginSkills())
	if len(catalog.Items) != 1 || catalog.Items[0].Available || catalog.Items[0].Reason != "safe_mode" {
		t.Fatal("safe mode advertised an existing owner's skill")
	}
	requirePluginSkillFailure(t, fixture.app.PluginSkillRead(status.Manifest.ID, "investigate", status.Digest, status.Generation), "runtime_unavailable")
	if _, err := PluginSkillManagerForIntegration(fixture.app.ctx, fixture.app); !errors.Is(err, plugin.ErrDisabled) {
		t.Fatalf("integration did not apply safe mode: %v", err)
	}
}

func TestPluginSkillWebDeniesDirectAccessWithExistingOwner(t *testing.T) {
	fixture := newPluginSkillFixture(t)
	status := startPluginSkillFixture(t, fixture)
	fixture.app.webRuntime = true
	requirePluginSkillFailure(t, fixture.app.PluginSkills(), "management_denied")
	requirePluginSkillFailure(t, fixture.app.PluginSkillRead(status.Manifest.ID, "investigate", status.Digest, status.Generation), "management_denied")
	requirePluginSkillFailure(t, fixture.app.PluginSkillResourceRead(status.Manifest.ID, "investigate", status.Digest, "skills/investigate/REFERENCE.md", status.Generation), "management_denied")
	if _, err := PluginSkillManagerForIntegration(fixture.app.ctx, fixture.app); err == nil {
		t.Fatal("Web direct API bypassed the skill access policy")
	}
	if _, ok := reflect.TypeOf(fixture.app).MethodByName("PluginSkillManagerForIntegration"); ok {
		t.Fatal("integration capability was exposed on a reflective App bridge")
	}
}

func TestPluginSkillWebDenialBeforeStorageAccess(t *testing.T) {
	a := newPluginTestApp(t)
	a.webRuntime = true
	requirePluginSkillFailure(t, a.PluginSkills(), "management_denied")
	requirePluginSkillFailure(t, a.PluginSkillRead("", "", "", 0), "management_denied")
	requirePluginSkillFailure(t, a.PluginSkillResourceRead("", "", "", "skills/investigate/REFERENCE.md", 1), "management_denied")
	if _, err := PluginSkillManagerForIntegration(a.ctx, a); err == nil {
		t.Fatal("Web integration returned a manager")
	}
	if _, err := os.Stat(filepath.Join(a.configDir, "plugins")); !os.IsNotExist(err) {
		t.Fatalf("denied skill access touched storage: %v", err)
	}
	requirePluginSkillNoStartup(t, a)
}

func TestPluginSkillContextHandlersPreserveCancellation(t *testing.T) {
	a := newPluginTestApp(t)
	handlers := WebRPCContextHandlers(a)
	list, ok := handlers["PluginSkills"].(func(context.Context) connection.QueryResult)
	if !ok {
		t.Fatal("context-aware skill discovery handler missing")
	}
	read, ok := handlers["PluginSkillRead"].(func(context.Context, string, string, string, uint64) connection.QueryResult)
	if !ok {
		t.Fatal("context-aware skill reader handler missing")
	}
	for _, method := range []string{"PluginSkills", "PluginSkillRead"} {
		if !slices.Contains(RequiredIssue1098WebRPCContextMethods(), method) {
			t.Fatalf("skill method not required to route request context: %s", method)
		}
	}
	ctx, cancel := context.WithCancel(a.ctx)
	cancel()
	requirePluginSkillFailure(t, list(ctx), "runtime_unavailable")
	requirePluginSkillFailure(t, read(ctx, "test.skills", "investigate", strings.Repeat("a", 64), 1), "runtime_unavailable")
	if _, err := PluginSkillManagerForIntegration(ctx, a); !errors.Is(err, context.Canceled) {
		t.Fatalf("integration lost request cancellation: %v", err)
	}
	if _, err := os.Stat(filepath.Join(a.configDir, "plugins")); !os.IsNotExist(err) {
		t.Fatalf("canceled skill request touched storage: %v", err)
	}
	requirePluginSkillNoStartup(t, a)
}

func TestPluginSkillReadCanceledContextWithOwnedRuntime(t *testing.T) {
	fixture := newPluginSkillFixture(t)
	status := startPluginSkillFixture(t, fixture)
	ctx, cancel := context.WithCancel(fixture.app.ctx)
	cancel()
	requirePluginSkillFailure(t, fixture.app.pluginSkillReadContext(ctx, status.Manifest.ID, "investigate", status.Digest, status.Generation), "runtime_unavailable")
	requirePluginSkillFailure(t, fixture.app.pluginSkillsContext(ctx), "runtime_unavailable")
	if _, err := PluginSkillManagerForIntegration(ctx, fixture.app); !errors.Is(err, context.Canceled) {
		t.Fatalf("owned runtime ignored cancellation: %v", err)
	}
}

func TestPluginSkillIntegrationNilAndMetadataOwner(t *testing.T) {
	if _, err := PluginSkillManagerForIntegration(context.Background(), nil); err == nil {
		t.Fatal("nil App accepted")
	}
	fixture := newPluginSkillFixture(t)
	startPluginSkillFixture(t, fixture)
	if _, err := PluginSkillManagerForIntegration(nil, fixture.app); err == nil {
		t.Fatal("nil context accepted")
	}
	ctx, cancel := context.WithCancel(fixture.app.ctx)
	defer cancel()
	session := newMetadataSessionWithMode(fixture.app, ctx, true)
	defer session.Close()
	if session.app.pluginRuntimeOwner() != fixture.app || session.app.pluginDataSourceOwner() != fixture.app ||
		session.app.pluginRuntimeContext() != ctx || session.app.pluginDataSourceContext() != ctx {
		t.Fatal("metadata session lost the shared owner or request context")
	}
	manager, err := PluginSkillManagerForIntegration(ctx, session.app)
	if err != nil || manager != fixture.manager || session.app.plugins.manager != nil {
		t.Fatalf("metadata view created or copied an execution owner: %v", err)
	}
	if !session.app.pluginRuntimeOwnsRuntime() || !session.app.pluginDataSourceOwnsRuntime() {
		t.Fatal("shared ownership view disagrees with datasource wrapper")
	}
	catalog := pluginSkillCatalogResult(t, session.app.PluginSkills())
	if len(catalog.Items) != 1 || !catalog.Items[0].Available {
		t.Fatal("metadata view failed to borrow the existing runtime")
	}
	cancel()
	if _, err := session.app.pluginRuntimeStatuses(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("shared metadata view lost cancellation: %v", err)
	}
}
