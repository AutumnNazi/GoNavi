package sessionassets

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// SourceDiscoverer 是来源发现能力接口（消费方定义，适配器实现）。
// 返回通用发现结果，实现层负责把工具私有格式转换过来；broken 单列，
// 不与“来源不可达”混同。
type SourceDiscoverer interface {
	DiscoverSourceSessions(ctx context.Context, dataDir string) (sessions []DiscoveredSession, broken []string, err error)
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
	Discovered  int      `json:"discovered"`
	BrokenFiles int      `json:"brokenFiles"`
	UpdatedRefs int      `json:"updatedRefs"`
	Backfilled  int      `json:"backfilled"`
	MarkedGone  []string `json:"markedGone"`
}

// SyncSource 把一次发现结果并入索引：幂等纳入资产、维护来源引用状态、
// 对仍存在的归档补保存（FR-06）。scanOK 表示目录扫描完整成功——只有
// 此时才允许把消失的引用标记为明确删除（V-22：不把不可达误报为删除）。
func (s *Service) SyncSource(ctx context.Context, source Source, sessions []DiscoveredSession, scanOK bool) (SourceSyncReport, error) {
	report := SourceSyncReport{Discovered: len(sessions)}
	seenThreadIDs := make(map[string]bool, len(sessions))
	for _, session := range sessions {
		threadID := strings.TrimSpace(session.NativeThreadID)
		if threadID == "" {
			continue
		}
		seenThreadIDs[threadID] = true
		status := SourceStatusActive
		if session.Archived {
			status = SourceStatusArchived
		}
		asset, err := s.catalog.UpsertAsset(ctx, AssetInput{
			IntegrationID:  source.IntegrationID,
			NativeThreadID: threadID,
			SourceID:       source.ID,
			NativePath:     session.NativePath,
			SourceStatus:   status,
			ProjectDir:     session.ProjectDir,
			Provider:       session.Provider,
			Model:          session.Model,
			UpdatedAt:      session.ModifiedAt,
		})
		if err != nil {
			// 被用户删除抑制的身份安静跳过，不报错、不重新纳入。
			if errors.Is(err, ErrSuppressed) {
				continue
			}
			return report, fmt.Errorf("sync discovered session: %w", err)
		}
		report.UpdatedRefs++
		if session.Archived {
			backfilled, err := s.backfillArchivedAsset(ctx, asset.ID, source.ID, session)
			if err != nil {
				return report, err
			}
			if backfilled {
				report.Backfilled++
			}
		}
	}

	if scanOK {
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

// backfillArchivedAsset 对已有归档触发首次保全：仅当资产还没有 latest
// 且没有进行中的任务（FR-06 / V-08）。
func (s *Service) backfillArchivedAsset(ctx context.Context, assetID, sourceID string, session DiscoveredSession) (bool, error) {
	asset, err := s.catalog.GetAsset(ctx, assetID)
	if err != nil {
		return false, err
	}
	if asset.LatestGenerationID != "" {
		return false, nil
	}
	active, err := s.catalog.HasActiveCaptureJob(ctx, assetID)
	if err != nil {
		return false, err
	}
	if active {
		return false, nil
	}
	_, err = s.EnqueueCapture(ctx, BuildSessionCaptureRequest(assetID, sourceID, session))
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

// BuildSessionCaptureRequest 构造单文件会话保全请求（rollout 自包含：
// 内嵌消息与附件，无外部依赖时 ancestors/attachments 为空）。
func BuildSessionCaptureRequest(assetID, sourceID string, session DiscoveredSession) CaptureRequest {
	return CaptureRequest{
		AssetID:        assetID,
		SourceID:       sourceID,
		Trigger:        string(CaptureTriggerArchiveEvent),
		NativeThreadID: session.NativeThreadID,
		SourcePath:     session.NativePath,
		SourceSize:     session.Size,
		SourceModTime:  session.ModifiedAt,
		Files: []MaterialFile{{
			RelPath:         "raw/rollout.jsonl",
			SourcePath:      session.NativePath,
			Role:            string(MaterialRolePrimary),
			ExpectedSize:    session.Size,
			ExpectedModTime: session.ModifiedAt,
		}},
	}
}
