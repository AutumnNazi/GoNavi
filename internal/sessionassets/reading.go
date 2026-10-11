package sessionassets

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

// 资产读源标识：界面顶部“当前材料来源”的数据来源。文案由前端按标识
// 与覆盖时间渲染，后端不硬编码用户可见句子。
const (
	ReadSourceLive    = "live"
	ReadSourceBackup  = "backup"
	ReadSourceMissing = "missing"
)

// AssetFilter 是列表查询条件；全部字段可选。
type AssetFilter struct {
	Query        string `json:"query"`
	SourceID     string `json:"sourceId"`
	ProjectDir   string `json:"projectDir"`
	Provider     string `json:"provider"`
	SourceStatus string `json:"sourceStatus"`
	BackupStatus string `json:"backupStatus"`
	Page         int    `json:"page"`
	PageSize     int    `json:"pageSize"`
}

// AssetView 是会话列表条目：主信息为标题，副标题为最后一次用户输入
// 预览，辅助显示项目、provider 与原记录/备份两个状态维度。
type AssetView struct {
	ID                 string `json:"id"`
	NativeThreadID     string `json:"nativeThreadId"`
	Title              string `json:"title"`
	ProjectDir         string `json:"projectDir"`
	Provider           string `json:"provider"`
	Model              string `json:"model"`
	LastUserPreview    string `json:"lastUserPreview"`
	UpdatedAt          int64  `json:"updatedAt"`
	SourceStatus       string `json:"sourceStatus"`
	BackupStatus       string `json:"backupStatus"`
	MaterialStatus     string `json:"materialStatus"`
	LatestGenerationID string `json:"latestGenerationId"`
	LatestComplete     bool   `json:"latestComplete"`
	LastBackupAt       int64  `json:"lastBackupAt"`
	HasBackup          bool   `json:"hasBackup"`
}

// AssetDetail 是详情视图：读源带、覆盖时间、来源引用与材料清单。
type AssetDetail struct {
	AssetView
	ReadSource    string               `json:"readSource"`
	ReadPath      string               `json:"readPath"`
	CoverageAt    int64                `json:"coverageAt"`
	SourceRefs    []SourceRef          `json:"sourceRefs"`
	MaterialFiles []MaterialFileRecord `json:"materialFiles"`
	Ancestors     []AncestorDependency `json:"ancestors"`
	Attachments   []AttachmentRecord   `json:"attachments"`
	Missing       []MissingRecord      `json:"missing"`
	Jobs          []CaptureJob         `json:"recentJobs"`
}

// ListAssetsView 返回筛选分页后的列表视图（按源更新时间倒序；备份时间
// 不扰动排序，V-07）。
func (s *Service) ListAssetsView(ctx context.Context, integrationID string, filter AssetFilter) ([]AssetView, int, error) {
	assets, total, err := s.catalog.QueryAssets(ctx, integrationID, filter)
	if err != nil {
		return nil, 0, err
	}
	statusByAsset, err := s.catalog.SourceStatusByAsset(ctx, integrationID)
	if err != nil {
		return nil, 0, err
	}
	views := make([]AssetView, 0, len(assets))
	for _, asset := range assets {
		view := assetToView(asset)
		view.SourceStatus = statusByAsset[asset.ID]
		views = append(views, view)
	}
	return views, total, nil
}

// AssetDetail 组装详情：读源判定——原路径可读优先，其次 latest 副本，
// 两者皆无时明确 missing，不制造空白“已恢复”会话。
func (s *Service) AssetDetail(ctx context.Context, assetID string) (AssetDetail, error) {
	asset, err := s.catalog.GetAsset(ctx, assetID)
	if err != nil {
		return AssetDetail{}, err
	}
	detail := AssetDetail{AssetView: assetToView(asset)}
	refs, err := s.catalog.ListSourceRefs(ctx, assetID)
	if err != nil {
		return AssetDetail{}, err
	}
	detail.SourceRefs = refs
	detail.SourceStatus = s.summarizeSourceStatus(refs)
	for _, ref := range refs {
		if ref.NativePath != "" {
			if _, err := os.Stat(ref.NativePath); err == nil {
				detail.ReadSource = ReadSourceLive
				detail.ReadPath = ref.NativePath
				break
			}
		}
	}
	if detail.ReadSource == "" && asset.LatestGenerationID != "" {
		rawPath := filepath.Join(s.paths.GenerationDir(assetID, asset.LatestGenerationID), "raw", "rollout.jsonl")
		if _, err := os.Stat(rawPath); err == nil {
			detail.ReadSource = ReadSourceBackup
			detail.ReadPath = rawPath
			detail.CoverageAt = asset.LastBackupAt
		}
	}
	if detail.ReadSource == "" {
		detail.ReadSource = ReadSourceMissing
	}
	if asset.LatestGenerationID != "" {
		manifest, err := readManifestJSON(s.paths.GenerationDir(assetID, asset.LatestGenerationID))
		if err == nil {
			detail.MaterialFiles = manifest.Files
			detail.Ancestors = manifest.Ancestors
			detail.Attachments = manifest.Attachments
			detail.Missing = manifest.Missing
		}
	}
	// Go nil slice 序列化为 JSON null，前端按数组消费会把 null.length
	// 读炸（用户实测：材料页签整页崩溃）。这里统一归一为空数组。
	if detail.MaterialFiles == nil {
		detail.MaterialFiles = []MaterialFileRecord{}
	}
	if detail.Ancestors == nil {
		detail.Ancestors = []AncestorDependency{}
	}
	if detail.Attachments == nil {
		detail.Attachments = []AttachmentRecord{}
	}
	if detail.Missing == nil {
		detail.Missing = []MissingRecord{}
	}
	if detail.SourceRefs == nil {
		detail.SourceRefs = []SourceRef{}
	}
	jobs, err := s.catalog.ListCaptureJobs(ctx, assetID)
	if err == nil && len(jobs) > 5 {
		jobs = jobs[:5]
	}
	if jobs == nil {
		jobs = []CaptureJob{}
	}
	detail.Jobs = jobs
	return detail, nil
}

// summarizeSourceStatus 聚合来源引用为一列内的原记录状态展示值：
// 任一可读来源按其状态呈现（archived/active 优先），全部明确删除才呈现
// 删除，否则未知。仅元数据维度，不影响副本可用性（需求 §4.3）。
func (s *Service) summarizeSourceStatus(refs []SourceRef) string {
	if len(refs) == 0 {
		return string(SourceStatusUnknown)
	}
	archived, active, deleted := false, false, false
	for _, ref := range refs {
		switch SourceStatus(ref.SourceStatus) {
		case SourceStatusActive:
			active = true
		case SourceStatusArchived:
			archived = true
		case SourceStatusDeleted:
			deleted = true
		}
	}
	switch {
	case active:
		return string(SourceStatusActive)
	case archived:
		return string(SourceStatusArchived)
	case deleted:
		return string(SourceStatusDeleted)
	default:
		return string(SourceStatusUnknown)
	}
}

func assetToView(asset Asset) AssetView {
	return AssetView{
		ID:                 asset.ID,
		NativeThreadID:     asset.NativeThreadID,
		Title:              asset.Title,
		ProjectDir:         asset.ProjectDir,
		Provider:           asset.Provider,
		Model:              asset.Model,
		LastUserPreview:    asset.LastUserPreview,
		UpdatedAt:          asset.UpdatedAt,
		BackupStatus:       asset.BackupStatus,
		MaterialStatus:     asset.MaterialStatus,
		LatestGenerationID: asset.LatestGenerationID,
		LatestComplete:     asset.LatestComplete,
		LastBackupAt:       asset.LastBackupAt,
		HasBackup:          asset.LatestGenerationID != "",
	}
}

// HasReadableHistory 报告详情读源是否可用于历史阅读。
func (d *AssetDetail) HasReadableHistory() bool {
	return d.ReadSource == ReadSourceLive || d.ReadSource == ReadSourceBackup
}

// ErrNoReadableHistory 表示资产既无可读原源也无可用副本正文。
var ErrNoReadableHistory = errors.New("no readable history for asset")
