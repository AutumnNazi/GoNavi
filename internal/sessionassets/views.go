package sessionassets

// DetectionView 是检测与启用页使用的组合视图：工具探测结果加上当前
// 数据根内的集成状态。前端据此决定启用、重新检测还是打开管理。
type DetectionView struct {
	Kind              string   `json:"kind"`
	DetectionStatus   string   `json:"detectionStatus"`
	IntegrationStatus string   `json:"integrationStatus"`
	CommandPath       string   `json:"commandPath"`
	Version           string   `json:"version"`
	DataDir           string   `json:"dataDir"`
	DataReadable      bool     `json:"dataReadable"`
	MaterialsRoot     string   `json:"materialsRoot"`
	IntegrationID     string   `json:"integrationId"`
	Details           []string `json:"details"`
}

// 集成状态（在探测状态之上合成，含数据根级状态）。
const (
	IntegrationStatusReadyToEnable = "ready_to_enable"
	IntegrationStatusEnabled       = "enabled"
	IntegrationStatusDisabled      = "disabled"
	IntegrationStatusLibraryLocked = "library_locked"
	IntegrationStatusUnsupported   = "unsupported"
)

// AgentIntegrationSummary 是主页智能体分组节点的数据源。
type AgentIntegrationSummary struct {
	IntegrationID string `json:"integrationId"`
	Kind          string `json:"kind"`
	DisplayName   string `json:"displayName"`
	Enabled       bool   `json:"enabled"`
	AssetCount    int    `json:"assetCount"`
}

// DetectInput 是检测请求参数；两个定位字段为空时使用默认探测。
type DetectInput struct {
	Kind        string `json:"kind"`
	CommandPath string `json:"commandPath"`
	DataDir     string `json:"dataDir"`
}

// EnableInput 是启用请求参数。DataDir 与 MaterialsRoot 为空时分别使用
// 探测默认位置与数据根默认材料库位置。
type EnableInput struct {
	Kind          string `json:"kind"`
	CommandPath   string `json:"commandPath"`
	DataDir       string `json:"dataDir"`
	MaterialsRoot string `json:"materialsRoot"`
}

// NormalizeAgentKind 校验并归一工具类型。首版仅支持 Codex（S-01），
// 其他类型返回 false，由调用方给出“尚未支持”文案。
func NormalizeAgentKind(kind string) (string, bool) {
	normalized := normalizeKind(AgentKind(kind))
	return string(normalized), normalized == AgentKindCodex
}
