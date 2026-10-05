package sessionassets

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	"GoNavi-Wails/internal/appdata"
	"GoNavi-Wails/internal/logger"
)

// workerPollInterval 是队列为空时 worker 的轮询间隔。文件观察接入后
// （M3）事件会直接入队，该间隔只兜底错过的入队信号。
const workerPollInterval = 500 * time.Millisecond

// workerStopTimeout 限制停止时等待正在执行任务的时间；超时后任务继续在
// 后台收尾，进程退出由 Wails 关闭序列约束。
const workerStopTimeout = 5 * time.Second

// Service 是会话资产领域服务：持有材料库锁、目录索引与后台保存队列。
// 单个材料库同时只有一个写入者；第二个实例 Open 返回 ErrLibraryLocked。
type Service struct {
	paths      LibraryPaths
	catalog    *Catalog
	lock       io.Closer
	finalizeMu sync.Mutex

	mu           sync.Mutex
	workerCancel context.CancelFunc
	workerWG     sync.WaitGroup
	closed       bool

	observerMu   sync.Mutex
	observers    map[string]*SourceObserver
	lifecycleCtx context.Context
	lifecycleCancel context.CancelFunc
}

// Open 打开（必要时初始化）材料库并执行启动核对。核对在返回前完成，
// 之后调用方可以启动保存 worker。
func Open(materialsRoot string) (*Service, error) {
	paths, err := NewLibraryPaths(materialsRoot)
	if err != nil {
		return nil, err
	}
	for _, dir := range []string{paths.Root, paths.AssetsDir(), paths.StagingDir(), paths.DerivedDir(), paths.HandoffsDir()} {
		if err := ensureDir(dir); err != nil {
			return nil, err
		}
	}
	lock, err := appdata.TryAcquireFileLock(paths.CatalogLockPath())
	if err != nil {
		if errors.Is(err, appdata.ErrFileLockHeld) {
			return nil, ErrLibraryLocked
		}
		return nil, fmt.Errorf("acquire session assets library lock: %w", err)
	}
	catalog, err := OpenCatalog(paths.CatalogPath())
	if err != nil {
		_ = lock.Close()
		return nil, err
	}
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	service := &Service{
		paths:           paths,
		catalog:         catalog,
		lock:            lock,
		observers:       make(map[string]*SourceObserver),
		lifecycleCtx:    lifecycleCtx,
		lifecycleCancel: lifecycleCancel,
	}
	if err := service.Reconcile(context.Background()); err != nil {
		_ = catalog.Close()
		_ = lock.Close()
		return nil, fmt.Errorf("reconcile session assets library: %w", err)
	}
	return service, nil
}

// Close 停止后台保存、关闭索引并释放材料库锁。退出 GoNavi 后运行期
// 保护随之停止（S-13），不宣称停机后继续保护。
func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	cancel := s.workerCancel
	s.mu.Unlock()

	if cancel != nil {
		cancel()
		done := make(chan struct{})
		go func() {
			s.workerWG.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(workerStopTimeout):
			logger.Warnf("session assets worker did not stop within %s", workerStopTimeout)
		}
	}
	s.observerMu.Lock()
	observers := s.observers
	s.observers = map[string]*SourceObserver{}
	s.observerMu.Unlock()
	for _, observer := range observers {
		observer.Close()
	}
	if s.lifecycleCancel != nil {
		s.lifecycleCancel()
	}
	return errors.Join(s.catalog.Close(), s.lock.Close())
}

// Paths 返回材料库路径集合（只读视图）。
func (s *Service) Paths() LibraryPaths { return s.paths }

// Catalog 返回目录索引，供绑定层查询；服务关闭后返回 nil。
func (s *Service) Catalog() *Catalog { return s.catalog }

// lifecycleContext 返回服务级生命周期上下文：观察与后台回调共用，
// Close 时取消。
func (s *Service) lifecycleContext() context.Context {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.lifecycleCtx == nil {
		return context.Background()
	}
	return s.lifecycleCtx
}

// StartWorker 启动后台保存 worker。重复启动是空操作；禁用集成应改用
// 停止 worker 或不入队，而不是关闭服务。
func (s *Service) StartWorker(parent context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.workerCancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(parent)
	s.workerCancel = cancel
	s.workerWG.Add(1)
	go func() {
		defer s.workerWG.Done()
		s.workerLoop(ctx)
	}()
}

// workerLoop 逐个认领并执行队列任务；取消后立即退出。
func (s *Service) workerLoop(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		processed, err := s.runWorkerOnce(ctx)
		if err != nil && !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrClosed) {
			logger.Error(err, "session assets worker iteration failed")
		}
		if ctx.Err() != nil {
			return
		}
		if !processed {
			timer.Reset(workerPollInterval)
		}
	}
}

// runWorkerOnce 认领并执行至多一个任务。返回是否处理了任务；测试用它
// 同步推进队列。
func (s *Service) runWorkerOnce(ctx context.Context) (bool, error) {
	if err := s.ensureOpen(); err != nil {
		return false, err
	}
	job, err := s.catalog.ClaimNextQueuedJob(ctx)
	if err != nil {
		return false, err
	}
	s.processCaptureJob(ctx, job)
	return true, nil
}

// ensureOpen 在公开方法入口检查服务状态。
func (s *Service) ensureOpen() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.catalog == nil {
		return ErrClosed
	}
	return nil
}
