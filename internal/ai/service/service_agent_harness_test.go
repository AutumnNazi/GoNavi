package aiservice

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/appdata"
	"GoNavi-Wails/internal/secretstore"
	"GoNavi-Wails/internal/uievents"
)

type agentHarnessTestSecretStore struct {
	mu    sync.Mutex
	items map[string][]byte
}

func newAgentHarnessTestSecretStore() *agentHarnessTestSecretStore {
	return &agentHarnessTestSecretStore{items: make(map[string][]byte)}
}

func (s *agentHarnessTestSecretStore) Put(ref string, value []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[ref] = append([]byte(nil), value...)
	return nil
}

func (s *agentHarnessTestSecretStore) Get(ref string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	value, ok := s.items[ref]
	if !ok {
		return nil, os.ErrNotExist
	}
	return append([]byte(nil), value...), nil
}

func (s *agentHarnessTestSecretStore) Delete(ref string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.items, ref)
	return nil
}

func (s *agentHarnessTestSecretStore) HealthCheck() error { return nil }

var _ secretstore.SecretStore = (*agentHarnessTestSecretStore)(nil)

type agentHarnessTestEmitter struct {
	mu     sync.Mutex
	events []runharness.RunEvent
}

func (e *agentHarnessTestEmitter) Emit(name string, args ...any) {
	if name != runharness.EventName || len(args) != 1 {
		return
	}
	event, ok := args[0].(runharness.RunEvent)
	if !ok {
		return
	}
	e.mu.Lock()
	e.events = append(e.events, event)
	e.mu.Unlock()
}

func (e *agentHarnessTestEmitter) count() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.events)
}

// ledgerObservingMCPHTTPProcess proves the shutdown order without relying on
// SQLite implementation details: Stop must run while the detached Ledger is
// still live, and the test checks it is closed only after Shutdown returns.
type ledgerObservingMCPHTTPProcess struct {
	*fakeMCPHTTPProcess
	ledger                    *runharness.Ledger
	ledgerAvailableDuringStop bool
}

func (p *ledgerObservingMCPHTTPProcess) Stop(ctx context.Context) error {
	_, err := p.ledger.ListSessions(context.Background(), runharness.SessionListRequest{Limit: 1})
	p.ledgerAvailableDuringStop = err == nil
	return p.fakeMCPHTTPProcess.Stop(ctx)
}

func newInitializedAgentHarnessService(t *testing.T) (*Service, *agentHarnessTestEmitter) {
	t.Helper()
	service := NewServiceWithSecretStore(newAgentHarnessTestSecretStore())
	service.configDir = t.TempDir()
	emitter := &agentHarnessTestEmitter{}
	ctx := uievents.WithEmitter(context.Background(), emitter)
	service.agentContext = ctx
	if err := service.initializeAgentHarness(ctx); err != nil {
		t.Fatalf("initializeAgentHarness: %v", err)
	}
	t.Cleanup(service.Shutdown)
	return service, emitter
}

func TestServiceRunPolicyRoundTripAndNormalization(t *testing.T) {
	service := NewServiceWithSecretStore(newAgentHarnessTestSecretStore())
	service.configDir = t.TempDir()
	initial, err := service.AIGetRunPolicy()
	if err != nil {
		t.Fatalf("AIGetRunPolicy: %v", err)
	}
	if initial.Revision != 1 {
		t.Fatalf("initial policy revision = %d, want 1", initial.Revision)
	}
	policy := runharness.RunPolicy{SoftToolRoundLimit: 2, MaxToolRounds: 4}
	saved, err := service.AISaveRunPolicy(runharness.RunPolicyMutationRequest{
		ExpectedRevision: initial.Revision,
		Policy:           policy,
	})
	if err != nil {
		t.Fatalf("AISaveRunPolicy: %v", err)
	}
	if saved.Revision != initial.Revision+1 || saved.Policy.DefaultDispatchMode != runharness.DispatchQueue || saved.Policy.MaxToolRounds != 4 || saved.Policy.MaxToolResultBytes == 0 {
		t.Fatalf("saved policy was not normalized: %+v", saved)
	}
	loaded, err := service.AIGetRunPolicy()
	if err != nil {
		t.Fatalf("AIGetRunPolicy: %v", err)
	}
	if loaded != saved {
		t.Fatalf("loaded policy %+v differs from saved %+v", loaded, saved)
	}
	data, err := os.ReadFile(filepath.Join(service.configDir, agentRunPolicyFileName))
	if err != nil {
		t.Fatalf("read policy file: %v", err)
	}
	var envelope runharness.RunPolicySnapshot
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatalf("decode policy file: %v", err)
	}
	if envelope != saved {
		t.Fatalf("unexpected policy envelope: %+v", envelope)
	}
	_, err = service.AISaveRunPolicy(runharness.RunPolicyMutationRequest{
		ExpectedRevision: initial.Revision,
		Policy:           runharness.DefaultRunPolicy(),
	})
	if !errors.Is(err, runharness.ErrRevisionConflict) || !strings.Contains(err.Error(), "revision_conflict") {
		t.Fatalf("stale policy save error = %v, want revision_conflict", err)
	}
	if err := service.shutdownAgentHarness(); err != nil {
		t.Fatalf("shutdown helper: %v", err)
	}
}

func TestServiceAgentWailsMethodsUseSharedLedger(t *testing.T) {
	service, emitter := newInitializedAgentHarnessService(t)

	snapshot := runharness.WorkspaceSnapshot{
		SourceKind:       runharness.WorkspaceCLI,
		SourceID:         "test-source",
		SourceInstanceID: "instance-1",
		Revision:         1,
		CapturedAt:       time.Now(),
	}
	ack, err := service.AIUpdateWorkspaceSnapshot(snapshot)
	if err != nil {
		t.Fatalf("AIUpdateWorkspaceSnapshot: %v", err)
	}
	if !ack.Accepted || ack.Revision != 1 || ack.ContentHash == "" {
		t.Fatalf("unexpected snapshot ack: %+v", ack)
	}

	receipt, err := service.AISubmitAgentInput(runharness.AgentInputRequest{
		RequestID: "service-request-1",
		Content:   "hello",
	})
	if err != nil {
		t.Fatalf("AISubmitAgentInput: %v", err)
	}
	if receipt.SessionID == "" || receipt.RunID == "" {
		t.Fatalf("input receipt missing IDs: %+v", receipt)
	}

	list, err := service.AIListAgentSessions(runharness.SessionListRequest{Limit: 10})
	if err != nil {
		t.Fatalf("AIListAgentSessions: %v", err)
	}
	if list.Total != 1 || len(list.Sessions) != 1 || list.Sessions[0].ID != receipt.SessionID {
		t.Fatalf("unexpected session list: %+v", list)
	}

	var read runharness.RunReadResult
	for deadline := time.Now().Add(2 * time.Second); time.Now().Before(deadline); {
		read, err = service.AIReadAgentRun(runharness.RunReadRequest{RunID: receipt.RunID})
		if err != nil {
			t.Fatalf("AIReadAgentRun: %v", err)
		}
		if len(read.Events) > 0 || read.Run.State.Terminal() {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if read.Run.ID != receipt.RunID || len(read.Events) == 0 {
		t.Fatalf("run read did not include persisted events: %+v", read)
	}
	if emitter.count() == 0 {
		t.Fatal("expected persisted run events to be emitted through uievents")
	}
}

func TestServiceAgentWailsMethodsRequireLifecycleContext(t *testing.T) {
	service := NewServiceWithSecretStore(newAgentHarnessTestSecretStore())
	service.configDir = t.TempDir()

	_, err := service.AISubmitAgentInput(runharness.AgentInputRequest{
		RequestID: "missing-lifecycle",
		Content:   "hello",
	})
	if !errors.Is(err, ErrAgentLifecycleUnavailable) {
		t.Fatalf("AISubmitAgentInput error = %v, want ErrAgentLifecycleUnavailable", err)
	}
	if _, statErr := os.Stat(filepath.Join(service.configDir, "agent_runs.sqlite")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("agent ledger was created without lifecycle context: %v", statErr)
	}
}

func TestServiceAgentLedgerStatusIsNonSensitive(t *testing.T) {
	readyService, _ := newInitializedAgentHarnessService(t)
	if status := readyService.AIGetAgentLedgerStatus(); status.State != runharness.LedgerStatusReady || status.Message != "" {
		t.Fatalf("ready ledger status = %+v", status)
	}

	lockedService := NewServiceWithSecretStore(secretstore.NewUnavailableStore("test keyring unavailable"))
	lockedService.configDir = t.TempDir()
	lockedService.agentContext = context.Background()
	if err := lockedService.initializeAgentHarness(lockedService.agentContext); err == nil {
		t.Fatal("initializeAgentHarness unexpectedly succeeded with an unavailable keyring")
	}
	if status := lockedService.AIGetAgentLedgerStatus(); status.State != runharness.LedgerStatusLocked || status.Message != "" {
		t.Fatalf("locked ledger status = %+v", status)
	}

	unavailableService := NewServiceWithSecretStore(newAgentHarnessTestSecretStore())
	if status := unavailableService.AIGetAgentLedgerStatus(); status.State != runharness.LedgerStatusUnavailable || status.Message != "" {
		t.Fatalf("unavailable ledger status = %+v", status)
	}
}

func TestServiceExposesOnlyAgentRunHarnessChatBoundary(t *testing.T) {
	serviceType := reflect.TypeOf((*Service)(nil))

	for _, method := range []string{
		"AISubmitAgentInput",
		"AIControlAgentRun",
		"AIReadAgentRun",
		"AIListAgentSessions",
		"AIReadAgentSession",
		"AIMutateAgentSession",
		"AIUpdateWorkspaceSnapshot",
		"AIGetAgentLedgerStatus",
		"AIGetRunPolicy",
		"AISaveRunPolicy",
	} {
		if _, ok := serviceType.MethodByName(method); !ok {
			t.Fatalf("new agent harness method %s is not exposed", method)
		}
	}

	for _, method := range []string{
		"AIChatSend",
		"AIChatSendWithOptions",
		"AIChatSendInSession",
		"AIChatStream",
		"AIChatStreamWithOptions",
		"AIChatCancel",
		"AIChatCancelAndWait",
		"AIChatCancelAllAndWait",
		"AIGetSessions",
		"AILoadSession",
		"AISaveSession",
		"AIDeleteSession",
		"ShutdownWithContext",
	} {
		if _, ok := serviceType.MethodByName(method); ok {
			t.Fatalf("legacy AI chat method %s must not be exposed", method)
		}
	}
}

func TestServiceShutdownWithContextClosesLedgerAfterMCP(t *testing.T) {
	originalStarter := startMCPHTTPProcess
	originalHealth := waitMCPHTTPHealth
	t.Cleanup(func() {
		startMCPHTTPProcess = originalStarter
		waitMCPHTTPHealth = originalHealth
	})

	service, _ := newInitializedAgentHarnessService(t)
	service.agentMu.RLock()
	ledger := service.agentLedger
	service.agentMu.RUnlock()
	if ledger == nil {
		t.Fatal("expected initialized agent ledger")
	}

	process := &ledgerObservingMCPHTTPProcess{
		fakeMCPHTTPProcess: newFakeMCPHTTPProcess(),
		ledger:             ledger,
	}
	startMCPHTTPProcess = func(_ context.Context, _ mcpHTTPProcessStartOptions, _ mcpHTTPTextLookup) (mcpHTTPProcess, error) {
		return process, nil
	}
	waitMCPHTTPHealth = func(_ context.Context, _ string, _ mcpHTTPTextLookup) error {
		return nil
	}
	if _, err := service.AIStartMCPHTTPServer(ai.MCPHTTPServerOptions{Addr: "127.0.0.1:0", Path: "/mcp"}); err != nil {
		t.Fatalf("AIStartMCPHTTPServer: %v", err)
	}

	ShutdownWithContext(service, context.Background())
	if !process.ledgerAvailableDuringStop {
		t.Fatal("MCP stopped after the agent ledger was closed")
	}
	if _, err := ledger.ListSessions(context.Background(), runharness.SessionListRequest{}); !errors.Is(err, runharness.ErrClosed) {
		t.Fatalf("ledger error after shutdown = %v, want ErrClosed", err)
	}
	if _, err := service.AIListAgentSessions(runharness.SessionListRequest{}); !errors.Is(err, runharness.ErrHarnessClosed) {
		t.Fatalf("agent call after shutdown = %v, want ErrHarnessClosed", err)
	}
}

func TestServiceAgentPolicyRejectsInvalidValues(t *testing.T) {
	service := NewServiceWithSecretStore(newAgentHarnessTestSecretStore())
	service.configDir = t.TempDir()
	_, err := service.AISaveRunPolicy(runharness.RunPolicyMutationRequest{
		ExpectedRevision: 1,
		Policy:           runharness.RunPolicy{SoftToolRoundLimit: -1},
	})
	if err == nil {
		t.Fatal("AISaveRunPolicy accepted a negative limit")
	}
	if errors.Is(err, runharness.ErrHarnessClosed) {
		t.Fatal("policy validation should not report a closed harness")
	}
}

func TestServiceAgentPolicyRejectsShutdownWithoutChangingFile(t *testing.T) {
	service, _ := newInitializedAgentHarnessService(t)
	initial, err := service.AIGetRunPolicy()
	if err != nil {
		t.Fatalf("AIGetRunPolicy: %v", err)
	}
	ShutdownWithContext(service, context.Background())

	_, err = service.AISaveRunPolicy(runharness.RunPolicyMutationRequest{
		ExpectedRevision: initial.Revision,
		Policy:           runharness.RunPolicy{SoftToolRoundLimit: 2, MaxToolRounds: 4},
	})
	if !errors.Is(err, runharness.ErrHarnessClosed) {
		t.Fatalf("shutdown policy save error = %v, want ErrHarnessClosed", err)
	}
	loaded, err := service.AIGetRunPolicy()
	if err != nil {
		t.Fatalf("AIGetRunPolicy after rejected save: %v", err)
	}
	if loaded != initial {
		t.Fatalf("shutdown policy save changed durable policy: before=%+v after=%+v", initial, loaded)
	}
}

func TestServiceAgentPolicyLiveUpdateFailureRollsBackDurableFile(t *testing.T) {
	service, _ := newInitializedAgentHarnessService(t)
	initial, err := service.AIGetRunPolicy()
	if err != nil {
		t.Fatalf("AIGetRunPolicy: %v", err)
	}
	service.agentMu.RLock()
	harness := service.agentHarness
	service.agentMu.RUnlock()
	if harness == nil {
		t.Fatal("expected initialized harness")
	}
	// Simulate a close that races after the service has acquired its pointer but
	// before the live runtime setter. AISaveRunPolicy must restore the file when
	// SetRuntimeConfig rejects the update. Deliberately close the Harness
	// directly so the Service has not yet detached its pointer.
	if err := harness.Close(); err != nil {
		t.Fatalf("close harness: %v", err)
	}
	_, err = service.AISaveRunPolicy(runharness.RunPolicyMutationRequest{
		ExpectedRevision: initial.Revision,
		Policy:           runharness.RunPolicy{SoftToolRoundLimit: 2, MaxToolRounds: 4},
	})
	if !errors.Is(err, runharness.ErrHarnessClosed) {
		t.Fatalf("live policy update error = %v, want ErrHarnessClosed", err)
	}
	loaded, err := service.AIGetRunPolicy()
	if err != nil {
		t.Fatalf("AIGetRunPolicy after rollback: %v", err)
	}
	if loaded != initial {
		t.Fatalf("failed live update changed durable policy: before=%+v after=%+v", initial, loaded)
	}
}

func TestServiceAgentPolicyWriteWaitsForCrossProcessLock(t *testing.T) {
	service := NewServiceWithSecretStore(newAgentHarnessTestSecretStore())
	service.configDir = t.TempDir()
	policyPath := service.agentPolicyPath()
	if err := os.MkdirAll(filepath.Dir(policyPath), 0o700); err != nil {
		t.Fatalf("create policy directory: %v", err)
	}
	lock, err := appdata.AcquireFileLock(policyPath + ".lock")
	if err != nil {
		t.Fatalf("acquire policy lock: %v", err)
	}

	finished := make(chan error, 1)
	go func() {
		_, saveErr := service.AISaveRunPolicy(runharness.RunPolicyMutationRequest{
			ExpectedRevision: 1,
			Policy:           runharness.RunPolicy{SoftToolRoundLimit: 2, MaxToolRounds: 4},
		})
		finished <- saveErr
	}()
	select {
	case saveErr := <-finished:
		t.Fatalf("policy save acquired cross-process lock before release: %v", saveErr)
	case <-time.After(50 * time.Millisecond):
	}
	if err := lock.Close(); err != nil {
		t.Fatalf("release policy lock: %v", err)
	}
	select {
	case saveErr := <-finished:
		if saveErr != nil {
			t.Fatalf("policy save after lock release: %v", saveErr)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("policy save did not acquire cross-process lock after release")
	}
}

func TestServiceAgentPolicyConcurrentServicesUseRevisionCAS(t *testing.T) {
	configDir := t.TempDir()
	first := NewServiceWithSecretStore(newAgentHarnessTestSecretStore())
	second := NewServiceWithSecretStore(newAgentHarnessTestSecretStore())
	first.configDir = configDir
	second.configDir = configDir

	start := make(chan struct{})
	type result struct {
		policy runharness.RunPolicySnapshot
		err    error
	}
	results := make(chan result, 2)
	for _, service := range []*Service{first, second} {
		service := service
		go func() {
			<-start
			policy, saveErr := service.AISaveRunPolicy(runharness.RunPolicyMutationRequest{
				ExpectedRevision: 1,
				Policy:           runharness.RunPolicy{SoftToolRoundLimit: 2, MaxToolRounds: 4},
			})
			results <- result{policy: policy, err: saveErr}
		}()
	}
	close(start)
	left := <-results
	right := <-results

	successes := 0
	conflicts := 0
	for _, item := range []result{left, right} {
		if item.err == nil {
			successes++
			if item.policy.Revision != 2 {
				t.Fatalf("successful policy revision = %d, want 2", item.policy.Revision)
			}
			continue
		}
		if errors.Is(item.err, runharness.ErrRevisionConflict) && strings.Contains(item.err.Error(), "revision_conflict") {
			conflicts++
			continue
		}
		t.Fatalf("unexpected concurrent policy save error: %v", item.err)
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent policy results: successes=%d conflicts=%d", successes, conflicts)
	}
}

func TestResolveAgentImagePromptsUsesCurrentLanguage(t *testing.T) {
	service := NewServiceWithSecretStore(newAgentHarnessTestSecretStore())
	service.AISetLanguage("zh-CN")
	prompts, err := service.resolveAgentImagePrompts(context.Background(), runharness.ModelTurnRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if prompts.FallbackPrompt != "请描述和分析这张图片。" {
		t.Fatalf("fallback prompt = %q", prompts.FallbackPrompt)
	}
	if prompts.OmittedNotice != "[图片已省略：当前模型或上游接口不支持图片输入。请切换到支持视觉的模型后重新发送图片。]" {
		t.Fatalf("omitted notice = %q", prompts.OmittedNotice)
	}
}

func TestLoadServiceRunPolicyRejectsMalformedWrapper(t *testing.T) {
	path := filepath.Join(t.TempDir(), agentRunPolicyFileName)
	if err := os.WriteFile(path, []byte(`{"policy":"broken","maxToolRounds":4}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadServiceRunPolicy(path); err == nil {
		t.Fatal("loadServiceRunPolicy accepted a malformed policy wrapper")
	}
}

func TestLoadServiceRunPolicyRejectsNullDocument(t *testing.T) {
	path := filepath.Join(t.TempDir(), agentRunPolicyFileName)
	if err := os.WriteFile(path, []byte(`null`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadServiceRunPolicy(path); err == nil {
		t.Fatal("loadServiceRunPolicy accepted a null document")
	}
}
