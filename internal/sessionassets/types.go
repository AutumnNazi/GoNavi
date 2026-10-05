package sessionassets

import "errors"

// AgentKind 标识一种智能体工具。首版仅接入 Codex；后续工具在此扩展，
// 各自声明能力，不继承 Codex 的支持状态。
type AgentKind string

// 支持的智能体工具类型。
const AgentKindCodex AgentKind = "codex"

// SourceStatus 是原始来源状态维度，与备份状态分维表达（需求 §4.3）。
type SourceStatus string

// 原始来源状态。
const (
	SourceStatusActive      SourceStatus = "active"
	SourceStatusArchived    SourceStatus = "archived"
	SourceStatusDeleted     SourceStatus = "deleted"
	SourceStatusUnreachable SourceStatus = "unreachable"
	SourceStatusUnknown     SourceStatus = "unknown"
)

// BackupStatus 是备份状态维度。活跃会话没有副本（none）是正常状态，不是失败。
type BackupStatus string

// 备份状态。
const (
	BackupStatusNone          BackupStatus = "none"
	BackupStatusSaving        BackupStatus = "saving"
	BackupStatusPendingVerify BackupStatus = "pending_verify"
	BackupStatusVerified      BackupStatus = "verified"
	BackupStatusUpdateFailed  BackupStatus = "update_failed"
	BackupStatusStaleOK       BackupStatus = "stale_ok"
	BackupStatusIncomplete    BackupStatus = "incomplete"
)

// MaterialStatus 是可读材料维度，描述已提交材料能否支撑阅读与复用。
type MaterialStatus string

// 可读材料状态。
const (
	MaterialStatusNotPrepared MaterialStatus = "not_prepared"
	MaterialStatusReadable    MaterialStatus = "readable"
	MaterialStatusPartial     MaterialStatus = "partial"
	MaterialStatusMissingDeps MaterialStatus = "missing_deps"
	MaterialStatusUnknown     MaterialStatus = "unknown"
)

// CaptureTrigger 说明一次保全任务的触发来源。
type CaptureTrigger string

// 保全触发来源。
const (
	CaptureTriggerArchiveEvent     CaptureTrigger = "archive_event"
	CaptureTriggerStartupReconcile CaptureTrigger = "startup_reconcile"
	CaptureTriggerManualRetry      CaptureTrigger = "manual_retry"
	CaptureTriggerEnableBackfill   CaptureTrigger = "enable_backfill"
)

// CaptureStatus 是保全任务的生命周期状态。partial_committed 表示只保存下
// 部分材料（无完整 latest 时展示），partial_discarded 表示已有完整 latest
// 因此放弃部分候选；两者都不宣称完整备份成功。
type CaptureStatus string

// 保全任务状态。
const (
	CaptureStatusQueued           CaptureStatus = "queued"
	CaptureStatusRunning          CaptureStatus = "running"
	CaptureStatusCommitted        CaptureStatus = "committed"
	CaptureStatusPartialCommitted CaptureStatus = "partial_committed"
	CaptureStatusPartialDiscarded CaptureStatus = "partial_discarded"
	CaptureStatusFailed           CaptureStatus = "failed"
	CaptureStatusCancelled        CaptureStatus = "cancelled"
)

// MaterialRole 区分材料文件在资产中的角色。祖先文件是 fork 固定前缀的
// 必要依赖，附件是会话引用的外部文件；角色决定删除与缺失报告的语义。
type MaterialRole string

// 材料文件角色。
const (
	MaterialRolePrimary    MaterialRole = "primary"
	MaterialRoleAncestor   MaterialRole = "ancestor"
	MaterialRoleAttachment MaterialRole = "attachment"
)

// AttachmentDisposition 区分附件可用性：路径存在不等于附件已保全
// （需求 §7.1）。embedded 指已内嵌在原始记录中，external 指外部文件
// 已复制进材料库，referenced 指仅保存引用，missing 指归档前已丢失。
type AttachmentDisposition string

// 附件处置状态。
const (
	AttachmentEmbedded   AttachmentDisposition = "embedded"
	AttachmentExternal   AttachmentDisposition = "external"
	AttachmentReferenced AttachmentDisposition = "referenced"
	AttachmentMissing    AttachmentDisposition = "missing"
)

// MissingReason 说明材料缺失的类别，进入 manifest 与失败报告。
type MissingReason string

// 材料缺失类别。
const (
	MissingAncestor     MissingReason = "ancestor"
	MissingAttachment   MissingReason = "attachment"
	MissingUnknownEntry MissingReason = "unknown_record"
)

// 领域错误。绑定层把它们转成 i18n 文案；领域层只返回类型化错误。
var (
	// ErrClosed 在服务关闭后调用其方法时返回。
	ErrClosed = errors.New("session assets service is closed")
	// ErrNotFound 表示请求的记录不存在。
	ErrNotFound = errors.New("session assets record not found")
	// ErrLibraryLocked 表示材料库已被另一个 GoNavi 实例占用（单写入者）。
	ErrLibraryLocked = errors.New("session assets library is locked by another writer")
	// ErrIntegrationExists 表示同工具已启用（幂等启用应改为读取现有配置）。
	ErrIntegrationExists = errors.New("agent integration already exists")
	// ErrSuppressed 表示资产身份已被用户删除并抑制，禁止重新纳入。
	ErrSuppressed = errors.New("session asset identity is suppressed by user deletion")
	// ErrSourceChanged 表示复制期间来源文件发生变化，候选不可信。
	ErrSourceChanged = errors.New("source file changed during capture")
	// ErrGenerationConflict 表示提交时 current 已被更前进的提交更新，
	// 旧任务不得覆盖较新结果。
	ErrGenerationConflict = errors.New("capture generation conflict")
	// ErrCandidateIncomplete 表示暂存候选缺少清单或文件校验失败，不能提交。
	ErrCandidateIncomplete = errors.New("capture candidate is incomplete")
)

// Integration 是一种智能体工具在一个数据根内的唯一接入记录。
type Integration struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	DisplayName string `json:"displayName"`
	Enabled     bool   `json:"enabled"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

// Source 是一个工具在本机的一个历史位置。同一工具可有多个来源；
// 规范化身份 identity_key 用于去重，provider、项目、入口不产生重复工具。
type Source struct {
	ID            string `json:"id"`
	IntegrationID string `json:"integrationId"`
	Kind          string `json:"kind"`
	DisplayName   string `json:"displayName"`
	RootPath      string `json:"rootPath"`
	IdentityKey   string `json:"identityKey"`
	Enabled       bool   `json:"enabled"`
	LastCheckedAt int64  `json:"lastCheckedAt"`
	CreatedAt     int64  `json:"createdAt"`
	UpdatedAt     int64  `json:"updatedAt"`
}

// Asset 是 GoNavi 管理的会话资产逻辑记录。native_thread_id 只在来源内
// 唯一，不是跨主机全局身份；备份相关字段是可重建投影，以提交清单为准。
type Asset struct {
	ID                 string `json:"id"`
	IntegrationID      string `json:"integrationId"`
	NativeThreadID     string `json:"nativeThreadId"`
	Title              string `json:"title"`
	ProjectDir         string `json:"projectDir"`
	Provider           string `json:"provider"`
	Model              string `json:"model"`
	CreatedAt          int64  `json:"createdAt"`
	UpdatedAt          int64  `json:"updatedAt"`
	FirstSeenAt        int64  `json:"firstSeenAt"`
	LastSeenAt         int64  `json:"lastSeenAt"`
	ForkParentThreadID string `json:"forkParentThreadId"`
	BackupStatus       string `json:"backupStatus"`
	MaterialStatus     string `json:"materialStatus"`
	LatestGenerationID string `json:"latestGenerationId"`
	LatestComplete     bool   `json:"latestComplete"`
	LastBackupAt       int64  `json:"lastBackupAt"`
}

// SourceRef 是资产在某一个来源下的引用：同一原始历史被多个入口发现时
// 合并为一个资产，各自保留路径与状态证据，不自动覆盖冲突。
type SourceRef struct {
	AssetID      string `json:"assetId"`
	SourceID     string `json:"sourceId"`
	NativePath   string `json:"nativePath"`
	SourceStatus string `json:"sourceStatus"`
	LastSeenAt   int64  `json:"lastSeenAt"`
}

// CaptureJob 是持久化的保全任务。base_generation_id 记录入队时的 current
// 指针，提交前重新校验，保证旧任务不能覆盖较新的提交结果。
type CaptureJob struct {
	ID               string `json:"id"`
	AssetID          string `json:"assetId"`
	SourceID         string `json:"sourceId"`
	Trigger          string `json:"trigger"`
	Status           string `json:"status"`
	BaseGenerationID string `json:"baseGenerationId"`
	GenerationID     string `json:"generationId"`
	Attempt          int    `json:"attempt"`
	Error            string `json:"error"`
	CreatedAt        int64  `json:"createdAt"`
	UpdatedAt        int64  `json:"updatedAt"`
}

// MaterialFile 描述一个待保全文件，由适配器解析来源后填充。expected_size
// 与 expected_mod_time 用于复制前后的来源变化检测；为 0 时跳过该项校验。
type MaterialFile struct {
	RelPath         string `json:"relPath"`
	SourcePath      string `json:"sourcePath"`
	Role            string `json:"role"`
	ExpectedSize    int64  `json:"expectedSize"`
	ExpectedModTime int64  `json:"expectedModTime"`
}

// AncestorDependency 声明 fork 的一个祖先及其固定边界。祖先文件按分叉点
// 保存固定前缀，父会话分叉后追加的内容不得混入子资产。
type AncestorDependency struct {
	NativeThreadID string         `json:"nativeThreadId"`
	BoundaryAt     int64          `json:"boundaryAt"`
	Files          []MaterialFile `json:"files"`
}

// AttachmentRecord 记录一个附件的处置结果。
type AttachmentRecord struct {
	Name        string `json:"name"`
	Disposition string `json:"disposition"`
	RelPath     string `json:"relPath,omitempty"`
}

// MissingRecord 记录一类缺失，进入 manifest.missing，阻止候选标记完整。
type MissingRecord struct {
	Reason string `json:"reason"`
	Detail string `json:"detail"`
}

// CaptureRequest 是一次保全请求的完整输入。首版由 Codex 适配器在归档
// 事件或启动核对时构造；本包只依赖该通用结构，不理解原始格式。
type CaptureRequest struct {
	AssetID        string               `json:"assetId"`
	SourceID       string               `json:"sourceId"`
	Trigger        string               `json:"trigger"`
	NativeThreadID string               `json:"nativeThreadId"`
	SourcePath     string               `json:"sourcePath"`
	SourceSize     int64                `json:"sourceSize"`
	SourceModTime  int64                `json:"sourceModTime"`
	Files          []MaterialFile       `json:"files"`
	Ancestors      []AncestorDependency `json:"ancestors"`
	Attachments    []AttachmentRecord   `json:"attachments"`
	Missing        []MissingRecord      `json:"missing"`
}

// SourceVersion 记录触发保全时观察到的来源版本，写入 manifest 用于追溯。
type SourceVersion struct {
	NativeThreadID string `json:"nativeThreadId"`
	Path           string `json:"path"`
	Size           int64  `json:"size"`
	ModTime        int64  `json:"modTime"`
}

// MaterialFileRecord 是 manifest 中一个已提交文件的登记：生成目录内相对
// 路径、大小、SHA-256 与角色。
type MaterialFileRecord struct {
	RelPath string       `json:"relPath"`
	Size    int64        `json:"size"`
	SHA256  string       `json:"sha256"`
	Role    MaterialRole `json:"role"`
}

// MaterialManifest 是 generations/<id>/manifest.json 的内容，声明该代次
// 覆盖范围与完整性。complete 为 false 表示部分材料，不得称为完整备份。
type MaterialManifest struct {
	FormatVersion int                  `json:"formatVersion"`
	GenerationID  string               `json:"generationId"`
	AssetID       string               `json:"assetId"`
	SourceID      string               `json:"sourceId"`
	IntegrationID string               `json:"integrationId"`
	Trigger       string               `json:"trigger"`
	Complete      bool                 `json:"complete"`
	CapturedAt    int64                `json:"capturedAt"`
	Source        SourceVersion        `json:"source"`
	Files         []MaterialFileRecord `json:"files"`
	Ancestors     []AncestorDependency `json:"ancestors"`
	Attachments   []AttachmentRecord   `json:"attachments"`
	Missing       []MissingRecord      `json:"missing"`
}

// CurrentPointer 是 assets/<id>/current.json 的内容：指向唯一有效的
// latest 代次。它的原子替换是提交事实，SQLite 状态是其可修复投影。
type CurrentPointer struct {
	FormatVersion int    `json:"formatVersion"`
	GenerationID  string `json:"generationId"`
	CommittedAt   int64  `json:"committedAt"`
	Complete      bool   `json:"complete"`
}
