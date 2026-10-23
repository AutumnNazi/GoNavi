package cli

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/plugin"
)

func TestCLIAgentSkillCatalogColdActivation(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	for _, workers := range []bool{false, true} {
		t.Run(map[bool]string{false: "readonly", true: "worker"}[workers], func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			root := t.TempDir()
			installColdSkill(t, ctx, root)
			owner, err := defaultAgentHarnessFactory(ctx, AgentHarnessOptions{DataRoot: root, KeyFile: filepath.Join(root, "agent.key"), StartWorkers: workers})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := owner.Close(); err != nil {
					t.Error(err)
				}
			})
			runtime, ok := owner.(*ledgerHarnessRuntime)
			if !ok {
				t.Fatal("unexpected runtime")
			}
			catalog := newCLIAgentToolCatalog(runtime.backend, runtime.mcp)
			// No wait-running helper is allowed between actual factory activation and List.
			descriptors, err := catalog.List(ctx)
			if err != nil {
				t.Fatal(err)
			}
			name := ""
			ordinary := false
			for _, descriptor := range descriptors {
				if strings.HasPrefix(descriptor.Name, "skill__") {
					name = descriptor.Name
				}
				if descriptor.Name == "execute_sql" {
					ordinary = true
				}
			}
			if !ordinary {
				t.Fatal("skill augmentation lost ordinary tools")
			}
			if !workers {
				if name != "" {
					t.Fatal("readonly factory advertised plugin skill")
				}
				return
			}
			if name == "" {
				t.Fatal("cold CLI worker catalog omitted file-only skill")
			}
			_, executor, err := catalog.Resolve(ctx, name)
			if err != nil {
				t.Fatal(err)
			}
			value, err := executor.Execute(ctx, runharness.ToolExecutionRequest{ToolName: name, Effect: runharness.ToolEffectReadOnly, Arguments: json.RawMessage("{}")})
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(value.Value)
			if err != nil || !strings.Contains(string(encoded), "STATIC_PACKAGE_BODY") {
				t.Fatalf("wrong CLI resource: %s %v", encoded, err)
			}
		})
	}
}

func installColdSkill(t *testing.T, ctx context.Context, root string) {
	t.Helper()
	packagePath := t.TempDir()
	manifest := plugin.Manifest{SchemaVersion: 1, APIVersion: 1, ID: "test.cold-skills", Name: "Cold Skills", Version: "1.0.0", Permissions: []string{"ai.skills"}, Contributes: plugin.Contributions{Skills: []plugin.Skill{{ID: "inspect", Name: "Inspect", Description: "Read supplied facts", Entry: "SKILL.md"}}}}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string][]byte{"gonavi.plugin.json": raw, "SKILL.md": []byte("# STATIC_PACKAGE_BODY\nRead supplied facts only.\n")} {
		if err := os.WriteFile(filepath.Join(packagePath, name), value, 0600); err != nil {
			t.Fatal(err)
		}
	}
	manager, err := plugin.NewManager(plugin.Options{Root: filepath.Join(root, "plugins")})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close(ctx)
	inspection, err := manager.Inspect(ctx, packagePath)
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.Install(ctx, plugin.InstallRequest{Path: packagePath, Digest: inspection.Digest, Trusted: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetEnabled(ctx, status.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	// No Manager.Start, no ready polling and no skill body read occurs here.
}
