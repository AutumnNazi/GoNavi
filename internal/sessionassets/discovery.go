package sessionassets

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// 扫描质量常量（由 adapter 把工具私有错误转换为统一语义）。
const (
	ScanQualityComplete    = "complete"    // 关键目录全部可读
	ScanQualityPartial     = "partial"     // 部分目录不可读，发现结果不完整
	ScanQualityUnreachable = "unreachable" // 来源根或归档目录整体不可达
)

// SourceScanResult 是一次来源扫描的完整结果：发现项、损坏清单与扫描
// 质量。Complete 为 false 时不得把消失的引用推断为明确删除（V-22）。
type SourceScanResult struct {
	Sessions    []DiscoveredSession
	Broken      []string
	Quality     string
	Complete    bool
	Unreachable bool
}

// SourceDiscoverer 是来源发现能力接口（消费方定义，适配器实现）。
// 返回通用发现结果，实现层负责把工具私有格式转换过来；broken 单列，
// 不与“来源不可达”混同。
type SourceDiscoverer interface {
	DiscoverSourceSessions(ctx context.Context, dataDir string) (SourceScanResult, error)
	// DiscoverSession 解析单个 rollout 文件的元数据；观察事件使用。
	DiscoverSession(ctx context.Context, path string, archived bool) (DiscoveredSession, error)
}

// DiscoveredSession 是一次来源扫描得到的会话元数据。取不到的字段留空。
type DiscoveredSession struct {
	NativeThreadID string
	NativePath     string
	Archived       bool
	ProjectDir     string
	Provider       string
	Model          string
	ModifiedAt     int64
	Size           int64
}

// SourceSyncReport 汇总一次来源核对的结果，保证可解释。
type SourceSyncReport struct {
	Discovered        int      `json:"discovered"`
	BrokenFiles       int      `json:"brokenFiles"`
	UpdatedRefs       int      `json:"updatedRefs"`
	Backfilled        int      `json:"backfilled"`
	MarkedGone        []string `json:"markedGone"`
	Quality           string   `json:"quality"`
	MarkedUnreachable bool     `json:"markedUnreachable"`
}

// SyncSource 把一次发现结果并入索引：幂等纳入资产、维护来源引用状态、
// 对仍存在的归档补保存（FR-06）。
//
// 扫描质量决定状态推断（V-22）：
//   - Complete：消失的引用推断为明确删除；
//   - Partial：正常处理发现项，但不做删除推断；
//   - Unreachable：全部引用改标“来源不可达”，保留最后观测与副本。
func (s *Service) SyncSource(ctx context.Context, source Source, result SourceScanResult) (SourceSyncReport, error) {
	sessions := result.Sessions
	report := SourceSyncReport{Discovered: len(sessions), Quality: result.Quality}
	seenThreadIDs := make(map[string]bool, len(sessions))
	for _, session := range sessions {
		threadID := strings.TrimSpace(session.NativeThreadID)
		if threadID == "" {
			continue
		}
		seenThreadIDs[threadID] = true
		// 旧引用状态要在纳入前取：UpsertAsset 会把引用刷成本轮观测。
		previous, err := s.catalog.FindSourceRefByThread(ctx, source.ID, threadID)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return report, err
		}
		status := SourceStatusActive
		if session.Archived {
			status = SourceStatusArchived
		}
		asset, err := s.catalog.UpsertAsset(ctx, AssetInput{
			IntegrationID:     source.IntegrationID,
			NativeThreadID:    threadID,
			SourceID:          source.ID,
			OriginIdentityKey: source.IdentityKey,
			NativePath:        session.NativePath,
			SourceStatus:      status,
			SourceSize:        session.Size,
			SourceModTime:     session.ModifiedAt,
			ProjectDir:        session.ProjectDir,
			Provider:          session.Provider,
			Model:             session.Model,
			UpdatedAt:         session.ModifiedAt,
		})
		if err != nil {
			// 被用户删除抑制的身份安静跳过，不报错、不重新纳入。
			if errors.Is(err, ErrSuppressed) {
				continue
			}
			return report, fmt.Errorf("sync discovered session: %w", err)
		}
		report.UpdatedRefs++
		if session.Archived && shouldCaptureArchive(previous, session) {
			queued, err := s.captureArchivedAsset(ctx, source, asset.ID, session)
			if err != nil {
				return report, err
			}
			if queued {
				report.Backfilled++
			}
		}
	}

	switch {
	case result.Unreachable || result.Quality == ScanQualityUnreachable:
		if err := s.catalog.MarkSourceRefsStatusForSource(ctx, source.ID, SourceStatusUnreachable); err != nil {
			return report, err
		}
		report.MarkedUnreachable = true
	case result.Complete:
		gone, err := s.markMissingRefsGone(ctx, source, seenThreadIDs)
		if err != nil {
			return report, err
		}
		report.MarkedGone = gone
	}
	if err := s.catalog.MarkSourceChecked(ctx, source.ID, source.DisplayName); err != nil {
		return report, err
	}
	return report, nil
}

// shouldCaptureArchive 判断一次全量扫描中的归档会话是否需要保全。
// 无既有引用（首次发现）或由其他状态转为归档都视为归档事件；
// 已归档的会话比较**源文件版本**（路径、大小、修改时间，P0-03）——
// 任一变化即重新保全；版本完全一致才跳过。
func shouldCaptureArchive(previous SourceRef, session DiscoveredSession) bool {
	if previous.SourceID == "" {
		return true
	}
	if previous.SourceStatus != string(SourceStatusArchived) {
		return true
	}
	if previous.NativePath != session.NativePath {
		return true
	}
	// 无版本信息的旧引用按“未知”处理，宁可重新保全也不留旧副本。
	if previous.SourceSize == 0 && previous.SourceMtime == 0 {
		return true
	}
	if session.Size != 0 && previous.SourceSize != 0 && session.Size != previous.SourceSize {
		return true
	}
	if session.ModifiedAt != 0 && previous.SourceMtime != 0 && session.ModifiedAt != previous.SourceMtime {
		return true
	}
	return false
}

// captureArchivedAsset 为归档会话安排保全：进行中的任务不重复排队
// （FR-06/FR-07/V-08）。重归档与首次补保存共用同一条替换事务。
func (s *Service) captureArchivedAsset(ctx context.Context, source Source, assetID string, session DiscoveredSession) (bool, error) {
	active, err := s.catalog.HasActiveCaptureJob(ctx, assetID)
	if err != nil {
		return false, err
	}
	if active {
		return false, nil
	}
	resolution := s.resolveDependencies(ctx, source, session)
	_, err = s.EnqueueCapture(ctx, BuildSessionCaptureRequest(assetID, source.ID, session, resolution))
	if err != nil {
		return false, err
	}
	return true, nil
}

// markMissingRefsGone 把本轮扫描未再出现、且指向已归档路径的引用标记为
// 明确删除。仅元数据维度变化：副本与资产不受影响（FR-生命周期表）。
func (s *Service) markMissingRefsGone(ctx context.Context, source Source, seenThreadIDs map[string]bool) ([]string, error) {
	assets, err := s.catalog.ListAssets(ctx, source.IntegrationID)
	if err != nil {
		return nil, err
	}
	gone := make([]string, 0)
	for _, asset := range assets {
		if seenThreadIDs[asset.NativeThreadID] {
			continue
		}
		refs, err := s.catalog.ListSourceRefs(ctx, asset.ID)
		if err != nil {
			return gone, err
		}
		for _, ref := range refs {
			if ref.SourceID != source.ID || ref.SourceStatus == string(SourceStatusDeleted) {
				continue
			}
			if err := s.catalog.UpdateSourceRefStatus(ctx, asset.ID, source.ID, SourceStatusDeleted); err != nil {
				return gone, err
			}
			gone = append(gone, asset.NativeThreadID)
		}
	}
	return gone, nil
}

// BuildSessionCaptureRequest 构造会话保全请求：rollout 主体自包含，
// 依赖解析发现的祖先文件与附件追加进请求；祖先文件未全部落地或存在
// 缺失项时通过 Missing 标注（候选不得标完整，FR-09）。
func BuildSessionCaptureRequest(assetID, sourceID string, session DiscoveredSession, resolution DependencyResolution) CaptureRequest {
	files := []MaterialFile{{
		RelPath:         "raw/rollout.jsonl",
		SourcePath:      session.NativePath,
		Role:            string(MaterialRolePrimary),
		ExpectedSize:    session.Size,
		ExpectedModTime: session.ModifiedAt,
	}}
	files = append(files, resolution.ExtraFiles...)
	missing := append([]MissingRecord(nil), resolution.Missing...)
	landed := make([]AncestorDependency, 0, len(resolution.Ancestors))
	for _, ancestor := range resolution.Ancestors {
		ready := make([]MaterialFile, 0, len(ancestor.Files))
		for _, file := range ancestor.Files {
			if strings.TrimSpace(file.SourcePath) != "" {
				ready = append(ready, file)
				continue
			}
			missing = append(missing, MissingRecord{
				Reason: string(MissingAncestor),
				Detail: "ancestor " + ancestor.NativeThreadID + " file not found",
			})
		}
		if len(ready) > 0 {
			ancestor.Files = ready
			landed = append(landed, ancestor)
		}
	}
	return CaptureRequest{
		AssetID:        assetID,
		SourceID:       sourceID,
		Trigger:        string(CaptureTriggerArchiveEvent),
		NativeThreadID: session.NativeThreadID,
		SourcePath:     session.NativePath,
		SourceSize:     session.Size,
		SourceModTime:  session.ModifiedAt,
		Files:          files,
		Ancestors:      landed,
		Attachments:    resolution.Attachments,
		Missing:        missing,
	}
}

// RetryCapture 对资产最后一次失败的保全任务重新入队（manual_retry）。
// 仅保留一个活跃任务（V-08）；被抑制或已删除的身份拒绝（FR-20）。
func (s *Service) RetryCapture(ctx context.Context, result SourceScanResult, assetID string) error {
	// 抑制检查在前：已删除/抑制的资产即便集成恢复启用也不可重试（FR-20）。
	suppressed, err := s.catalog.IsSuppressedByAsset(ctx, assetID)
	if err != nil {
		return err
	}
	if suppressed {
		return ErrSuppressed
	}
	asset, err := s.catalog.GetAsset(ctx, assetID)
	if err != nil {
		return err
	}
	enabled, err := s.catalog.IntegrationEnabledByID(ctx, asset.IntegrationID)
	if err != nil {
		return err
	}
	if !enabled {
		return ErrIntegrationDisabled
	}
	// 找最近一次失败任务的请求，按 manual_retry 重新入队。
	job, err := s.catalog.LatestFailedCaptureJob(ctx, assetID)
	if err != nil {
		return err
	}
	request, err := s.catalog.LoadCaptureRequest(ctx, job.ID)
	if err != nil {
		return err
	}
	request.Trigger = string(CaptureTriggerManualRetry)
	_, err = s.EnqueueCapture(ctx, request)
	return err
}
