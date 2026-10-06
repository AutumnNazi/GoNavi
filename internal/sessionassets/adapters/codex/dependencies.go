package codex

import (
	"bufio"
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"GoNavi-Wails/internal/sessionassets"
)

// 依赖解析（P0-05/FR-09/10/11）：流式扫描 rollout 正文，识别对其它
// rollout 文件的引用（fork/恢复线索）与外部附件线索。
//
// 保守边界：Codex 0.160 的 rollout 主体自包含；fork 引用没有稳定的
// 专用字段，这里按文件名引用启发式识别。识别不到依赖时不伪造
// Ancestors（保持自包含判定）；识别到但文件缺失时必须记入 Missing，
// 候选不得标完整。密文段不解码（V-17），由历史阅读层标不透明。

var rolloutRefPattern = regexp.MustCompile(`rollout-\d{4}-\d{2}-\d{2}T[0-9-]+-[0-9a-fA-F-]{8,}\.jsonl`)

// imageOrFileElement 捕获 content 中非文本元素的类型名，用于附件线索。
var imageOrFileElement = regexp.MustCompile(`"type"\s*:\s*"(input_image|image|file|local_image|pathed_file)"`)

// Resolution 是依赖解析结果，字段直接对应捕获请求的组成部分。
type Resolution struct {
	Ancestors   []sessionassets.AncestorDependency
	Attachments []sessionassets.AttachmentRecord
	ExtraFiles  []sessionassets.MaterialFile
	Missing     []sessionassets.MissingRecord
}

// ResolveSessionDependencies 解析一个 rollout 的 fork 祖先与外部附件线索。
// dataDir 用于在同来源内定位被引用的 rollout 文件。
func ResolveSessionDependencies(ctx context.Context, dataDir, sessionPath string) (Resolution, error) {
	resolution := Resolution{}
	file, err := os.Open(sessionPath)
	if err != nil {
		return resolution, err
	}
	defer file.Close()

	referenced := map[string]bool{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, maxHistoryLineBytes), maxHistoryLineBytes)
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return resolution, err
		}
		line := scanner.Text()
		for _, name := range rolloutRefPattern.FindAllString(line, -1) {
			if name != filepath.Base(sessionPath) {
				referenced[name] = true
			}
		}
		if imageOrFileElement.MatchString(line) && strings.Contains(line, `"path"`) {
			// 含 path 字段的图片/文件元素：提取线索路径（保守：仅记录
			// 引用存在性，路径解析属文件系统级证据）。
			resolution.Attachments = append(resolution.Attachments, sessionassets.AttachmentRecord{
				Name:        "path-referenced-element",
				Disposition: string(sessionassets.AttachmentReferenced),
			})
		}
	}
	if err := scanner.Err(); err != nil {
		return resolution, err
	}

	for name := range referenced {
		// 在同来源数据目录内定位被引用的 rollout：找到 → 作为 fork 祖先
		// 前缀副本（整文件，发现时点边界）；找不到 → 记入 Missing，
		// 候选不得标完整（FR-09）。
		ancestorPath := findRolloutFile(ctx, dataDir, name, 5)
		if ancestorPath == "" {
			resolution.Missing = append(resolution.Missing, sessionassets.MissingRecord{
				Reason: string(sessionassets.MissingAncestor),
				Detail: "rollout 引用 " + name + "（同来源内未找到对应文件）",
			})
			continue
		}
		if _, err := os.Stat(ancestorPath); err != nil {
			resolution.Missing = append(resolution.Missing, sessionassets.MissingRecord{
				Reason: string(sessionassets.MissingAncestor),
				Detail: "rollout 引用 " + name + " 无法读取: " + err.Error(),
			})
			continue
		}
		ancestorID := strings.TrimSuffix(strings.TrimPrefix(name, rolloutFilePrefix), rolloutFileSuffix)
		resolution.Ancestors = append(resolution.Ancestors, sessionassets.AncestorDependency{
			NativeThreadID: ancestorID,
			Files: []sessionassets.MaterialFile{{
				RelPath:    "ancestors/" + name,
				SourcePath: ancestorPath,
				Role:       string(sessionassets.MaterialRoleAncestor),
			}},
		})
	}
	_ = dataDir
	return resolution, nil
}

// ResolveDependencies 实现 sessionassets.DependencyResolver。
func (Discoverer) ResolveDependencies(ctx context.Context, dataDir, sessionPath string) (sessionassets.DependencyResolution, error) {
	resolution, err := ResolveSessionDependencies(ctx, dataDir, sessionPath)
	if err != nil {
		return sessionassets.DependencyResolution{}, err
	}
	return sessionassets.DependencyResolution{
		Ancestors:   resolution.Ancestors,
		Attachments: resolution.Attachments,
		ExtraFiles:  resolution.ExtraFiles,
		Missing:     resolution.Missing,
	}, nil
}

// findRolloutFile 在数据目录树内按文件名定位 rollout（归档扁平目录与
// 活跃目录树都查）；找不到返回空串。
func findRolloutFile(ctx context.Context, dataDir, name string, maxDepth int) string {
	candidates := []string{
		filepath.Join(dataDir, archivedSessionsDirName, name),
	}
	if path := findRolloutInTree(ctx, filepath.Join(dataDir, activeSessionsDirName), name, maxDepth); path != "" {
		return path
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func findRolloutInTree(ctx context.Context, root, name string, depth int) string {
	if depth < 0 {
		return ""
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return ""
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return ""
		}
		path := filepath.Join(root, entry.Name())
		if entry.IsDir() {
			if found := findRolloutInTree(ctx, path, name, depth-1); found != "" {
				return found
			}
			continue
		}
		if entry.Name() == name {
			return path
		}
	}
	return ""
}
