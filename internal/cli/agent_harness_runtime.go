package cli

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/ai/runharness"
	aiservice "GoNavi-Wails/internal/ai/service"
	"GoNavi-Wails/internal/mcpserver"
)

// cliProviderResolver freezes the fully-resolved provider configuration on the
// first model attempt for each run.  A queued run can therefore outlive a
// settings edit without silently switching endpoint, model, headers, or key
// halfway through its lifecycle.  The durable ExecutionBinding path will
// eventually move this cache into the Ledger; keeping the cache here preserves
// the invariant for the current ProviderResolver-only seam as well.
type cliProviderResolver struct {
	root string

	mu        sync.Mutex
	snapshots map[string]ai.ProviderConfig
}

// newCLIProviderInstance is a narrow test seam. Production code always uses
// provider.NewProvider; tests can inspect the exact frozen config without
// reaching into provider implementations' private fields.
var newCLIProviderInstance = provider.NewProvider

func newCLIProviderResolver(root string) runharness.ProviderResolver {
	return newCLIProviderResolverState(root).resolve
}

func newCLIProviderResolverState(root string) *cliProviderResolver {
	return &cliProviderResolver{root: strings.TrimSpace(root), snapshots: make(map[string]ai.ProviderConfig)}
}

// ForgetRun releases the in-memory provider snapshot after a run reaches a
// terminal state. The durable run binding remains the source of truth for a
// later process; this cache only bridges model attempts owned by this CLI
// runtime. It is safe to call repeatedly and concurrently with resolve.
func (r *cliProviderResolver) ForgetRun(runID string) {
	if r == nil {
		return
	}
	if runID = strings.TrimSpace(runID); runID == "" {
		return
	}
	r.mu.Lock()
	delete(r.snapshots, runID)
	r.mu.Unlock()
}

// ForgetAll releases every in-memory snapshot when the owning runtime shuts
// down. Do not use this for a live run: its next model attempt must continue
// using the original frozen configuration.
func (r *cliProviderResolver) ForgetAll() {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.snapshots = make(map[string]ai.ProviderConfig)
	r.mu.Unlock()
}

func (r *cliProviderResolver) cachedRunCount() int {
	if r == nil {
		return 0
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.snapshots)
}

func (r *cliProviderResolver) resolve(ctx context.Context, request runharness.ModelTurnRequest) (provider.Provider, error) {
	if r == nil {
		return nil, errors.New("AI provider resolver is unavailable")
	}
	// Serialize the first-load path per resolver. This both makes the cache
	// deterministic when a provider callback retries concurrently and prevents
	// two attempts for one run from observing different config file revisions.
	r.mu.Lock()
	defer r.mu.Unlock()
	if ctx == nil {
		return nil, runharness.ErrRootContextRequired
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	cacheKey := strings.TrimSpace(request.RunID)
	selected, cached := r.snapshots[cacheKey]
	if !cached || cacheKey == "" {
		store := aiservice.NewProviderConfigStore(r.root, nil)
		snapshot, err := store.LoadRuntime()
		if err != nil {
			return nil, fmt.Errorf("load AI provider configuration: %w", err)
		}
		selected, err = selectCLIProvider(snapshot, request.Provider)
		if err != nil {
			return nil, err
		}
		// These values are turn-scoped overrides. Do not write them back to
		// ai_config.json, because concurrent desktop runs may use the defaults.
		if value := strings.TrimSpace(request.Model); value != "" {
			selected.Model = value
		}
		if value := strings.TrimSpace(request.Thinking); value != "" {
			selected.ThinkingIntensity = value
		}
		if request.Temperature != nil {
			selected.Temperature = *request.Temperature
		}
		if request.MaxTokens != nil {
			selected.MaxTokens = *request.MaxTokens
		}
		// Keep a deep copy so a provider implementation cannot mutate the cache
		// through shared headers/models slices.
		selected = cloneCLIProviderConfig(selected)
		if cacheKey != "" {
			r.snapshots[cacheKey] = cloneCLIProviderConfig(selected)
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	instance, err := newCLIProviderInstance(selected)
	if err != nil {
		return nil, fmt.Errorf("initialize AI provider %q: %w", selected.ID, err)
	}
	return instance, nil
}

func cloneCLIProviderConfig(config ai.ProviderConfig) ai.ProviderConfig {
	clone := config
	clone.Models = append([]string(nil), config.Models...)
	clone.DisabledModels = append([]string(nil), config.DisabledModels...)
	clone.CustomModels = append([]string(nil), config.CustomModels...)
	if config.Headers != nil {
		clone.Headers = make(map[string]string, len(config.Headers))
		for key, value := range config.Headers {
			clone.Headers[key] = value
		}
	}
	return clone
}

func selectCLIProvider(snapshot aiservice.ProviderConfigStoreSnapshot, requested string) (ai.ProviderConfig, error) {
	requested = strings.TrimSpace(requested)
	if len(snapshot.Providers) == 0 {
		if requested != "" {
			return ai.ProviderConfig{}, fmt.Errorf("AI provider %q is not configured", requested)
		}
		return ai.ProviderConfig{}, errors.New("no AI provider is configured")
	}
	if requested != "" {
		for _, candidate := range snapshot.Providers {
			if candidate.ID == requested || strings.EqualFold(candidate.ID, requested) || strings.EqualFold(strings.TrimSpace(candidate.Name), requested) {
				return candidate, nil
			}
		}
		return ai.ProviderConfig{}, fmt.Errorf("AI provider %q is not configured", requested)
	}
	active := strings.TrimSpace(snapshot.ActiveProvider)
	if active != "" {
		for _, candidate := range snapshot.Providers {
			if candidate.ID == active || strings.EqualFold(candidate.ID, active) || strings.EqualFold(strings.TrimSpace(candidate.Name), active) {
				return candidate, nil
			}
		}
	}
	return snapshot.Providers[0], nil
}

// newCLIAgentToolCatalog returns the same complete audited catalog used by the
// desktop harness. Tool calls carry only saved connection IDs; the catalog
// resolves credentials inside the Go backend, while workspace inspection only
// reads the snapshot bound to the current run.
func newCLIAgentToolCatalog(backend mcpserver.Backend, mcpService *aiservice.Service) runharness.ToolCatalog {
	return mcpserver.NewCompositeToolCatalog(
		mcpserver.NewAgentToolCatalogWithDynamicSource(
			backend,
			mcpserver.NewServiceMCPSource(mcpService),
		),
		mcpserver.NewWorkspaceSnapshotToolCatalog(),
	)
}

// cliAgentApprovalHandler is intentionally non-interactive when stdin is not
// a character device. In that mode the harness persists an approval and the
// caller can use `gonavi agent approve` from a separate invocation.
type cliAgentApprovalHandler struct {
	openTTY func() (io.ReadWriteCloser, error)
	stdin   func() io.Reader
	stderr  io.Writer
	tty     func(io.Reader) bool
}

func newCLIAgentApprovalHandler() runharness.ApprovalHandler {
	return &cliAgentApprovalHandler{
		openTTY: openCLIAgentTTY,
		stdin:   currentAgentStdin,
		stderr:  os.Stderr,
		tty:     readerIsTTY,
	}
}

func (h *cliAgentApprovalHandler) Request(ctx context.Context, request runharness.ApprovalRequest) (runharness.ApprovalDecision, error) {
	if h == nil {
		return runharness.ApprovalDecision{}, runharness.ErrApprovalPending
	}
	if ctx == nil {
		return runharness.ApprovalDecision{}, runharness.ErrRootContextRequired
	}
	// A canceled worker must not turn into a pending approval merely because
	// it is running without a TTY. Return the lifecycle error before checking
	// interactivity so shutdown/SIGINT can complete the durable cancellation.
	if err := ctx.Err(); err != nil {
		return runharness.ApprovalDecision{}, err
	}
	input := io.Reader(nil)
	if h.stdin != nil {
		input = h.stdin()
	}
	if h.tty == nil || !h.tty(input) {
		return runharness.ApprovalDecision{}, runharness.ErrApprovalPending
	}
	if h.openTTY == nil {
		return runharness.ApprovalDecision{}, runharness.ErrApprovalPending
	}
	tty, err := h.openTTY()
	if err != nil || tty == nil {
		return runharness.ApprovalDecision{}, runharness.ErrApprovalPending
	}
	defer tty.Close()
	output := h.stderr
	if output == nil {
		output = io.Discard
	}
	fmt.Fprintf(output, "Agent approval required\nrun: %s\ncall: %s\napproval: %s\ntool: %s\neffect: %s\nargs-hash: %s\nApprove? [y/N] ", request.RunID, request.CallID, request.ApprovalID, request.ToolName, request.Effect, request.ArgsHash)

	reader := bufio.NewReader(tty)
	for {
		lineCh := make(chan string, 1)
		errCh := make(chan error, 1)
		go func() {
			line, readErr := reader.ReadString('\n')
			if readErr != nil && len(line) == 0 {
				errCh <- readErr
				return
			}
			lineCh <- line
		}()
		select {
		case <-ctx.Done():
			return runharness.ApprovalDecision{}, ctx.Err()
		case err := <-errCh:
			if errors.Is(err, io.EOF) {
				return runharness.ApprovalDecision{}, runharness.ErrApprovalPending
			}
			return runharness.ApprovalDecision{}, err
		case line := <-lineCh:
			switch strings.ToLower(strings.TrimSpace(line)) {
			case "y", "yes":
				return runharness.ApprovalDecision{ApprovalID: request.ApprovalID, Decision: "approved"}, nil
			case "", "n", "no":
				return runharness.ApprovalDecision{ApprovalID: request.ApprovalID, Decision: "denied"}, nil
			default:
				fmt.Fprint(output, "Please answer y or n: ")
			}
		}
	}
}

func openCLIAgentTTY() (io.ReadWriteCloser, error) {
	return os.OpenFile("/dev/tty", os.O_RDWR, 0)
}

func readerIsTTY(reader io.Reader) bool {
	file, ok := reader.(*os.File)
	if !ok || file == nil {
		return false
	}
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

var _ runharness.ProviderResolver = newCLIProviderResolver("")
var _ runharness.ToolCatalog = newCLIAgentToolCatalog(nil, nil)
var _ runharness.ApprovalHandler = (*cliAgentApprovalHandler)(nil)
