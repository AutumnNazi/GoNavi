package sessionassets

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// 观察参数。归档意图立即入队（不故意推迟首次复制，技术方案 §5），
// 同路径重复事件由任务去重兜底。
const (
	observerEventBuffer  = 64 // fsnotify 事件通道缓冲：吸收突发目录事件
	observerQuietWindow  = 300 * time.Millisecond
	observerLoopInterval = 200 * time.Millisecond
)

// 观察错误。
var (
	// ErrObserverAlreadyRunning 表示该来源已在观察中（重复启动幂等）。
	ErrObserverAlreadyRunning = errors.New("source observation already running")
)

// SourceObserver 以文件观察覆盖一个来源的归档与会话目录。观察只在
// GoNavi 运行期间存在（S-13）；停机期间的归档由启动核对补保存。
type SourceObserver struct {
	sourceID      string
	integrationID string
	dataDir       string
	watcher       *fsnotify.Watcher
	events        chan fsnotify.Event
	ctx           context.Context
	cancel        context.CancelFunc
	wg            sync.WaitGroup
	onArchive     func(sourceID, path string)
	onSessions    func(sourceID, path string)
}

// StartSourceObservation 启动一个来源的目录观察。onArchive 在归档目录
// 出现新 rollout 时触发；onSessions 在活跃目录出现新 rollout 时触发
// （只做元数据维护，不做正文复制）。
func (s *Service) StartSourceObservation(source Source, discoverer SourceDiscoverer, onArchiveReady func(sourceID string)) error {
	s.observerMu.Lock()
	defer s.observerMu.Unlock()
	if _, exists := s.observers[source.ID]; exists {
		return ErrObserverAlreadyRunning
	}
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("create session assets watcher: %w", err)
	}
	ctx, cancel := context.WithCancel(s.lifecycleContext())
	observer := &SourceObserver{
		sourceID:      source.ID,
		integrationID: source.IntegrationID,
		dataDir:       source.RootPath,
		watcher:       watcher,
		events:        make(chan fsnotify.Event, observerEventBuffer),
		ctx:           ctx,
		cancel:        cancel,
		onArchive:     s.archiveEventhandler(source, discoverer),
		onSessions:    s.sessionEventHandler(source, discoverer),
	}
	if err := observer.watchTree(observer.activeSessionsDir(), 4); err != nil {
		_ = watcher.Close()
		cancel()
		return fmt.Errorf("watch codex sessions tree: %w", err)
	}
	if err := observer.watchTree(observer.archivedSessionsDir(), 1); err != nil {
		_ = watcher.Close()
		cancel()
		return fmt.Errorf("watch codex archive directory: %w", err)
	}
	observer.wg.Add(1)
	go observer.loop()
	s.observers[source.ID] = observer
	if onArchiveReady != nil {
		onArchiveReady(source.ID)
	}
	return nil
}

// StopSourceObservation 停止一个来源的观察；禁用与重定位来源时调用。
func (s *Service) StopSourceObservation(sourceID string) {
	s.observerMu.Lock()
	observer := s.observers[sourceID]
	delete(s.observers, sourceID)
	s.observerMu.Unlock()
	if observer != nil {
		observer.Close()
	}
}

// StopIntegrationObservation 停止一个集成下全部来源的观察（禁用集成，
// FR-28）。返回被停止的来源 ID 列表。
func (s *Service) StopIntegrationObservation(integrationID string) []string {
	s.observerMu.Lock()
	stopped := make([]string, 0)
	observers := make([]*SourceObserver, 0)
	for id, observer := range s.observers {
		if observer.integrationID == integrationID {
			observers = append(observers, observer)
			stopped = append(stopped, id)
			delete(s.observers, id)
		}
	}
	s.observerMu.Unlock()
	for _, observer := range observers {
		observer.Close()
	}
	return stopped
}

// ObserversRunning 返回当前仍在观察的来源 ID 集合（状态展示用）。
func (s *Service) ObserversRunning() []string {
	s.observerMu.Lock()
	defer s.observerMu.Unlock()
	ids := make([]string, 0, len(s.observers))
	for id := range s.observers {
		ids = append(ids, id)
	}
	return ids
}

// integrationEnabled 检查集成当前是否启用。禁用后丢弃观察事件（FR-28）。
func (s *Service) integrationEnabled(ctx context.Context, integrationID string) bool {
	enabled, err := s.catalog.IntegrationEnabledByID(ctx, integrationID)
	if err != nil {
		return false
	}
	return enabled
}

// archiveEventhandler 归档事件处理：识别会话、纳入索引并立即安排
// 保全（意图持久化，任务去重防重复）。集成被禁用后丢弃事件（FR-28）。
func (s *Service) archiveEventhandler(source Source, discoverer SourceDiscoverer) func(string, string) {
	return func(sourceID, path string) {
		ctx := s.lifecycleContext()
		if !s.integrationEnabled(ctx, source.IntegrationID) {
			return
		}
		session, err := discoverer.DiscoverSession(ctx, path, true)
		if err != nil {
			return
		}
		asset, err := s.catalog.UpsertAsset(ctx, AssetInput{
			IntegrationID:     source.IntegrationID,
			OriginIdentityKey: source.IdentityKey,
			NativeThreadID:    session.NativeThreadID,
			SourceID:          source.ID,
			NativePath:        session.NativePath,
			SourceStatus:      SourceStatusArchived,
			SourceSize:        session.Size,
			SourceModTime:     session.ModifiedAt,
			ProjectDir:        session.ProjectDir,
			Provider:          session.Provider,
			Model:             session.Model,
			LastUserPreview:   session.LastUserPreview,
			UpdatedAt:         session.ModifiedAt,
		})
		if err != nil {
			return
		}
		_, _ = s.captureArchivedAsset(ctx, source, asset.ID, session)
	}
}

// sessionEventHandler 活跃会话事件处理：只维护基础元数据，不复制正文
// （FR-05）。集成被禁用后丢弃事件。
func (s *Service) sessionEventHandler(source Source, discoverer SourceDiscoverer) func(string, string) {
	return func(sourceID, path string) {
		ctx := s.lifecycleContext()
		if !s.integrationEnabled(ctx, source.IntegrationID) {
			return
		}
		session, err := discoverer.DiscoverSession(ctx, path, false)
		if err != nil {
			return
		}
		_, _ = s.catalog.UpsertAsset(ctx, AssetInput{
			IntegrationID:     source.IntegrationID,
			OriginIdentityKey: source.IdentityKey,
			NativeThreadID:    session.NativeThreadID,
			SourceID:          source.ID,
			NativePath:        session.NativePath,
			SourceStatus:      SourceStatusActive,
			SourceSize:        session.Size,
			SourceModTime:     session.ModifiedAt,
			ProjectDir:        session.ProjectDir,
			Provider:          session.Provider,
			Model:             session.Model,
			LastUserPreview:   session.LastUserPreview,
			UpdatedAt:         session.ModifiedAt,
		})
	}
}

func (o *SourceObserver) activeSessionsDir() string {
	return filepath.Join(o.dataDir, "sessions")
}

func (o *SourceObserver) archivedSessionsDir() string {
	return filepath.Join(o.dataDir, "archived_sessions")
}

// watchTree 递归登记现有子目录；运行期新建目录由事件循环补挂。
func (o *SourceObserver) watchTree(root string, maxDepth int) error {
	return o.watchDirRecursive(root, maxDepth)
}

func (o *SourceObserver) watchDirRecursive(root string, depth int) error {
	if depth < 0 {
		return nil
	}
	// 目录尚不存在（如会话目录未初始化）不算观察失败；目录创建事件会补挂。
	if _, err := os.Stat(root); err != nil {
		return nil
	}
	if err := o.watcher.Add(root); err != nil {
		return err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	for _, entry := range entries {
		if entry.IsDir() {
			if err := o.watchDirRecursive(filepath.Join(root, entry.Name()), depth-1); err != nil {
				return err
			}
		}
	}
	return nil
}

// loop 消费事件并按目录分类派发；退出条件是 ctx 取消。
func (o *SourceObserver) loop() {
	defer o.wg.Done()
	defer func() { _ = o.watcher.Close() }()
	quiet := make(map[string]time.Time)
	timer := time.NewTimer(observerLoopInterval)
	defer timer.Stop()
	for {
		select {
		case <-o.ctx.Done():
			return
		case event, ok := <-o.watcher.Events:
			if !ok {
				return
			}
			if event.Has(fsnotify.Create) || event.Has(fsnotify.Rename) || event.Has(fsnotify.Write) {
				if isDirPath(event.Name) {
					_ = o.watchDirRecursive(event.Name, 4)
					continue
				}
				if isRolloutPath(event.Name) {
					quiet[event.Name] = time.Now()
				}
			}
		case <-timer.C:
			o.dispatchReady(quiet)
			timer.Reset(observerLoopInterval)
		}
	}
}

// dispatchReady 派发安静窗口结束的事件：合并重复事件只减少重复工作，
// 不推迟首次归档超过一个窗口。
func (o *SourceObserver) dispatchReady(quiet map[string]time.Time) {
	now := time.Now()
	for path, seen := range quiet {
		if now.Sub(seen) < observerQuietWindow {
			continue
		}
		delete(quiet, path)
		switch {
		case underDir(path, o.archivedSessionsDir()):
			if o.onArchive != nil {
				o.onArchive(o.sourceID, path)
			}
		case underDir(path, o.activeSessionsDir()):
			if o.onSessions != nil {
				o.onSessions(o.sourceID, path)
			}
		}
	}
}

// Close 停止事件循环并释放 watcher。
func (o *SourceObserver) Close() {
	o.cancel()
	o.wg.Wait()
}

func isRolloutPath(path string) bool {
	name := filepath.Base(path)
	return strings.HasPrefix(name, "rollout-") && strings.HasSuffix(name, ".jsonl")
}

func isDirPath(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func underDir(path, dir string) bool {
	rel, err := filepath.Rel(dir, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
