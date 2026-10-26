package mcpserver

import (
	"context"
	"crypto/sha256"
	"encoding/base32"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/plugin"
)

const pluginToolPrefix = "plugin__"
const pluginToolMaxBytes = 1 << 20

// PluginToolCatalog exposes commands only after explicit ai.tools package trust.
// It borrows an existing manager and never starts, enables or owns a runtime.
type PluginToolCatalog struct {
	managerProvider func(context.Context) (*plugin.Manager, error)
	startupWait     time.Duration
}

// NewPluginToolCatalog attaches a host-owned manager accessor. A nil or
// unavailable accessor leaves built-in tools usable with no plugin descriptors.
func NewPluginToolCatalog(managerProvider func(context.Context) (*plugin.Manager, error)) *PluginToolCatalog {
	return &PluginToolCatalog{managerProvider: managerProvider, startupWait: 10 * time.Second}
}

var _ runharness.ToolCatalog = (*PluginToolCatalog)(nil)

type pluginToolBinding struct {
	descriptor runharness.ToolDescriptor
	pluginID   string
	command    string
	digest     string
	generation uint64
}

// List takes a fresh immutable-status snapshot without running plugin code.
// Only this plugin module degrades to empty when its manager is unavailable.
func (c *PluginToolCatalog) List(ctx context.Context) ([]runharness.ToolDescriptor, error) {
	if ctx == nil {
		return nil, runharness.ErrRootContextRequired
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	manager, err := c.manager(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return []runharness.ToolDescriptor{}, nil
	}
	statuses, err := c.waitForStarting(ctx, manager)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !manager.OwnsRuntime() {
		return []runharness.ToolDescriptor{}, nil
	}
	bindings, err := pluginToolBindings(statuses)
	if err != nil {
		return nil, err
	}
	result := make([]runharness.ToolDescriptor, 0, len(bindings))
	for _, binding := range bindings {
		result = append(result, binding.descriptor)
	}
	return result, nil
}

// Resolve captures both the executable generation and the complete descriptor.
// Capabilities include digest/generation, so the Harness's persisted descriptor
// comparison fences re-enable and package updates even with identical schemas.
func (c *PluginToolCatalog) Resolve(ctx context.Context, name string) (runharness.ToolDescriptor, runharness.ToolExecutor, error) {
	if ctx == nil {
		return runharness.ToolDescriptor{}, nil, runharness.ErrRootContextRequired
	}
	if err := ctx.Err(); err != nil {
		return runharness.ToolDescriptor{}, nil, err
	}
	if !strings.HasPrefix(name, pluginToolPrefix) {
		return runharness.ToolDescriptor{}, nil, ErrAgentToolNotFound
	}
	manager, err := c.manager(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return runharness.ToolDescriptor{}, nil, ctx.Err()
		}
		return runharness.ToolDescriptor{}, nil, fmt.Errorf("%w: plugin runtime unavailable", ErrAgentToolNotFound)
	}
	binding, err := resolvePluginToolBinding(manager.List(), name)
	if err != nil {
		return runharness.ToolDescriptor{}, nil, err
	}
	descriptor := cloneAgentToolDescriptors([]runharness.ToolDescriptor{binding.descriptor})[0]
	return descriptor, &pluginToolExecutor{manager: manager, binding: binding}, nil
}

func (c *PluginToolCatalog) manager(ctx context.Context) (*plugin.Manager, error) {
	if c == nil || c.managerProvider == nil {
		return nil, ErrAgentToolNotFound
	}
	manager, err := c.managerProvider(ctx)
	if err != nil {
		return nil, err
	}
	if manager == nil || !manager.OwnsRuntime() {
		return nil, ErrAgentToolNotFound
	}
	return manager, nil
}

func pluginToolBindings(statuses []plugin.Status) ([]pluginToolBinding, error) {
	result := make([]pluginToolBinding, 0)
	seen := make(map[string]bool)
	for _, status := range statuses {
		if !pluginToolsAvailable(status) {
			continue
		}
		reserved := pluginReservedCommands(status.Manifest)
		for _, command := range status.Manifest.Contributes.Commands {
			if reserved[command.ID] {
				continue
			}
			binding := newPluginToolBinding(status, command)
			if seen[binding.descriptor.Name] {
				return nil, fmt.Errorf("%w: duplicate plugin tool identity", ErrAgentToolArguments)
			}
			seen[binding.descriptor.Name] = true
			result = append(result, binding)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].descriptor.Name < result[j].descriptor.Name })
	return result, nil
}

func pluginToolsAvailable(status plugin.Status) bool {
	if !status.DesiredEnabled || status.State != plugin.StateRunning || status.Generation == 0 || status.Digest == "" {
		return false
	}
	for _, permission := range status.Manifest.Permissions {
		if permission == "ai.tools" {
			return true
		}
	}
	return false
}

func newPluginToolBinding(status plugin.Status, command plugin.Command) pluginToolBinding {
	// Full SHA-256 encoded as unpadded base32 gives a provider-safe 60-character
	// alias. Delimit the original IDs before hashing; lossy sanitization can collide.
	digest := sha256.Sum256([]byte(status.Manifest.ID + "\x00" + command.ID))
	name := pluginToolPrefix + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(digest[:]))
	description := command.Description
	if description == "" {
		description = command.Title
	}
	description = fmt.Sprintf("%s [plugin %s, command %s]", description, status.Manifest.ID, command.ID)
	return pluginToolBinding{
		pluginID: status.Manifest.ID, command: command.ID, digest: status.Digest, generation: status.Generation,
		descriptor: runharness.ToolDescriptor{
			Name: name, Description: description, InputSchema: append([]byte(nil), command.InputSchema...),
			// Trusting a native package is not proof its read effect claim is correct.
			// Unknown effects require Harness approval and are never replayed as reads.
			Effect: runharness.ToolEffectSideEffectUnknown, DefaultTimeout: 30 * time.Second, MaxResultBytes: pluginToolMaxBytes,
			Capabilities: []string{"plugin", "dynamic", "plugin.id=" + status.Manifest.ID, "plugin.command=" + command.ID,
				"plugin.digest=" + status.Digest, "plugin.generation=" + strconv.FormatUint(status.Generation, 10)},
		},
	}
}

func resolvePluginToolBinding(statuses []plugin.Status, name string) (pluginToolBinding, error) {
	bindings, err := pluginToolBindings(statuses)
	if err != nil {
		return pluginToolBinding{}, err
	}
	for _, binding := range bindings {
		if binding.descriptor.Name == name {
			return binding, nil
		}
	}
	return pluginToolBinding{}, fmt.Errorf("%w: plugin tool unavailable", ErrAgentToolNotFound)
}
