package cli

import (
	"context"
	"fmt"

	"GoNavi-Wails/internal/ai/runharness"
	aiservice "GoNavi-Wails/internal/ai/service"
	"GoNavi-Wails/internal/mcpserver"

	"github.com/google/uuid"
)

func newCLIPluginProviderHarness(ctx context.Context, root string, ledger *runharness.Ledger, backend mcpserver.Backend, service *aiservice.Service, runtimeConfig runharness.RunRuntimeConfig) (*cliProviderResolver, *runharness.AgentRunHarness, error) {
	resolver := newCLIProviderResolverState(root)
	resolver.plugins = mcpserver.NewPluginAIProviderFactoryForBackend(backend)
	if err := aiservice.ConfigurePluginProviderFactory(service, resolver.plugins); err != nil {
		return nil, nil, fmt.Errorf("configure agent plugin providers: %w", err)
	}
	harness, err := runharness.NewAgentRunHarness(runharness.HarnessConfig{
		Ledger:                         ledger,
		Model:                          runharness.NewProviderModelTurnAdapter(resolver.resolve),
		InputBinder:                    resolver.bindInput,
		Tools:                          newCLIAgentToolCatalog(backend, service),
		Approvals:                      newCLIAgentApprovalHandler(),
		RootContext:                    ctx,
		OwnerID:                        "gonavi-cli-" + uuid.NewString(),
		PollInterval:                   runtimeConfig.ControlPollInterval,
		WorkspaceSnapshotLeaseDuration: runtimeConfig.WorkspaceSnapshotLeaseDuration,
		WorkspaceSnapshotRenewInterval: runtimeConfig.WorkspaceSnapshotRenewInterval,
	})
	if err != nil {
		return nil, nil, err
	}
	return resolver, harness, nil
}
