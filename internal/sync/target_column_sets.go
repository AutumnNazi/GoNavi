package sync

import (
	"sort"
	"strings"

	"GoNavi-Wails/internal/connection"
)

// nil 表示没有可用元数据，兼容既有未限制列的路径；非 nil 空集表示明确没有允许的列。
func buildTargetColumnSet(cols []connection.ColumnDefinition) map[string]struct{} {
	if len(cols) == 0 {
		return nil
	}
	targetColSet := make(map[string]struct{}, len(cols))
	for _, col := range cols {
		lowerName := strings.ToLower(strings.TrimSpace(col.Name))
		if lowerName == "" {
			continue
		}
		targetColSet[lowerName] = struct{}{}
	}
	return targetColSet
}

// buildWritableTargetColumnSet 排除由目标数据库计算的生成列。
// 源生成列可以复制到普通目标列；缺列检测仍须使用目标存在性全集。
func buildWritableTargetColumnSet(cols []connection.ColumnDefinition) map[string]struct{} {
	if len(cols) == 0 {
		return nil
	}
	targetColSet := make(map[string]struct{}, len(cols))
	for _, col := range cols {
		lowerName := strings.ToLower(strings.TrimSpace(col.Name))
		if lowerName == "" || connection.IsGeneratedColumnExtra(col.Extra) {
			continue
		}
		targetColSet[lowerName] = struct{}{}
	}
	return targetColSet
}

func missingChangeSetColumns(changes connection.ChangeSet, targetCols []connection.ColumnDefinition) []string {
	existingSet := buildTargetColumnSet(targetCols)
	required := collectRequiredColumns(changes.Inserts, changes.Updates)
	missing := make([]string, 0)
	for lower, original := range required {
		if _, ok := existingSet[lower]; !ok {
			missing = append(missing, original)
		}
	}
	sort.Strings(missing)
	return missing
}
