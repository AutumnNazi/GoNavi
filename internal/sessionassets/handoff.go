package sessionassets

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// 交接结果分级（FR 分级报告）：材料就绪、入口已启动、会话已创建、
// 轮次执行完成是四个独立结果，不得互相冒充。首版自动路径只到
// entry_launched；会话创建与轮执行由原工具自身发生，GoNavi 不宣称。
const (
	HandoffStageMaterialsReady = "materials_ready"
	HandoffStageEntryLaunched  = "entry_launched"
	HandoffStageFailed         = "failed"
)

// 原生继续的能力前提（交互设计 §7）：来源仍可读、资产有原生 ID。
// provider 兼容性由原工具自行判定，GoNavi 不改写或伪造。
func CanResumeNatively(detail AssetDetail) bool {
	if detail.NativeThreadID == "" {
		return false
	}
	for _, ref := range detail.SourceRefs {
		if SourceStatus(ref.SourceStatus) == SourceStatusActive || SourceStatus(ref.SourceStatus) == SourceStatusArchived {
			if _, err := os.Stat(ref.NativePath); err == nil {
				return true
			}
		}
	}
	return false
}

// HandoffPlanView 是一次手动/自动交接准备的结果。
type HandoffPlanView struct {
	Stage         string `json:"stage"`
	AssetID       string `json:"assetId"`
	Mode          string `json:"mode"`
	MaterialsDir  string `json:"materialsDir,omitempty"`
	NoteFile      string `json:"noteFile,omitempty"`
	LaunchCommand string `json:"launchCommand,omitempty"`
	WorkDir       string `json:"workDir,omitempty"`
	Reason        string `json:"reason,omitempty"`
}

// PrepareHandoffMaterials 生成手动交接材料包：范围化可读历史、一份核验
// 过的操作说明（S-16：手动材料与说明是必需兜底）。reader 为空时跳过
// 可读导出，仅写说明。
func (s *Service) PrepareHandoffMaterials(ctx context.Context, detail AssetDetail, workDir string, scope HandoffScope, scanner HistoryStatsScanner, reader ReadableHistoryReader) (HandoffPlanView, error) {
	if err := sanitizeID(detail.ID); err != nil {
		return HandoffPlanView{}, err
	}
	if detail.LatestGenerationID == "" {
		return HandoffPlanView{Stage: HandoffStageFailed, AssetID: detail.ID, Mode: "manual", Reason: "no committed material"}, nil
	}
	stamp := time.Now().UTC().Format("20060102-150405")
	materialsDir := filepath.Join(s.Paths().HandoffsDir(), detail.ID, stamp)
	if err := ensureDir(materialsDir); err != nil {
		return HandoffPlanView{}, err
	}
	noteFile := filepath.Join(materialsDir, "handoff-notes.md")
	note := buildHandoffNotes(detail, workDir, scope)
	if err := writeFileSync(noteFile, []byte(note)); err != nil {
		return HandoffPlanView{}, err
	}
	if detail.HasReadableHistory() && reader != nil {
		normalized := NormalizeHandoffScope(scope.Mode, scope.From, scope.To)
		from, to := normalized.From, normalized.To
		if scanner != nil {
			if stats, err := scanner.ScanReadableStats(ctx, detail.ReadPath); err == nil {
				from, to = resolveScopeRange(normalized, stats)
			}
		}
		if _, err := s.WriteScopedReadableExport(ctx, detail, materialsDir, from, to, reader); err != nil {
			return HandoffPlanView{}, err
		}
	}
	if err := s.catalog.RecordHandoff(ctx, detail.ID, "manual", map[string]any{
		"materialsDir": materialsDir,
		"noteFile":     noteFile,
		"generationID": detail.LatestGenerationID,
		"scope":        scope,
	}); err != nil {
		return HandoffPlanView{}, err
	}
	return HandoffPlanView{
		Stage:        HandoffStageMaterialsReady,
		AssetID:      detail.ID,
		Mode:         "manual",
		MaterialsDir: materialsDir,
		NoteFile:     noteFile,
	}, nil
}

// buildHandoffNotes 生成操作说明：核验过的官方 CLI 步骤，明确“尚未创建
// 新会话”。不含凭据、不要求改全局配置。
func buildHandoffNotes(detail AssetDetail, workDir string, scope HandoffScope) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# 会话交接材料：%s\n\n", detailTitleOrID(detail))
	fmt.Fprintf(&b, "- 原生会话 ID：%s\n", detail.NativeThreadID)
	fmt.Fprintf(&b, "- 历史 provider/模型：%s / %s\n", emptyDash(detail.Provider), emptyDash(detail.Model))
	fmt.Fprintf(&b, "- 项目目录：%s\n", emptyDash(detail.ProjectDir))
	fmt.Fprintf(&b, "- 历史范围：%s（行 %d..%d）\n", emptyDash(scope.Mode), scope.From, scope.To)
	if detail.CoverageAt > 0 {
		fmt.Fprintf(&b, "- 备份覆盖时间：%s\n", time.Unix(detail.CoverageAt, 0).Format("2006-01-02 15:04:05"))
	}
	if !detail.LatestComplete {
		b.WriteString("- 注意：材料不完整（见清单缺失项），恢复范围以实际文件为准。\n")
	}
	b.WriteString("\n## 材料清单\n\n")
	for _, file := range detail.MaterialFiles {
		fmt.Fprintf(&b, "- %s（%d 字节，sha256 %s…）\n", file.RelPath, file.Size, shortSHA(file.SHA256))
	}
	for _, missing := range detail.Missing {
		fmt.Fprintf(&b, "- 缺失：%s：%s\n", missing.Reason, missing.Detail)
	}
	b.WriteString("\n## 在 Codex 中新建会话继续（手动路径）\n\n")
	b.WriteString("1. 上述材料目录是自包含副本；原始会话文件可能已被删除，不要依赖原路径。\n")
	if strings.TrimSpace(workDir) != "" {
		fmt.Fprintf(&b, "2. 在目标工作目录启动 Codex：在该目录运行 `codex`（交互模式）。\n")
	} else {
		b.WriteString("2. 在合适的工作目录启动 Codex：运行 `codex`（交互模式）。\n")
	}
	b.WriteString("3. 把本目录中的 `raw/rollout.jsonl` 与需要的历史条目作为参考资料交给 Codex；")
	b.WriteString("旧工具调用是事实记录，不应被当作待执行的命令。\n")
	b.WriteString("4. 新会话拥有新的会话 ID；本材料不代表原会话被恢复。\n")
	b.WriteString("\n## 原生续聊（同 provider，原会话仍存在时）\n\n")
	fmt.Fprintf(&b, "- 运行 `codex resume %s`。GoNavi 不保证该 ID 仍被原工具接受；受理与实际执行以 Codex 为准。\n", detail.NativeThreadID)
	return b.String()
}

func detailTitleOrID(detail AssetDetail) string {
	if strings.TrimSpace(detail.Title) != "" {
		return detail.Title
	}
	return detail.NativeThreadID
}

func emptyDash(value string) string {
	if strings.TrimSpace(value) == "" {
		return "-"
	}
	return value
}

func shortSHA(sha string) string {
	if len(sha) > 12 {
		return sha[:12]
	}
	return sha
}
