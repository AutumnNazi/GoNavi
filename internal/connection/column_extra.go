package connection

import "strings"

// IsGeneratedColumnExtra 判断列元数据 Extra 是否标记了不可写入的生成列。
//
// 各驱动把「数据库侧自己算值」的列写进 Extra：MySQL 是
// "VIRTUAL GENERATED"/"STORED GENERATED"，ClickHouse 是
// "MATERIALIZED"/"ALIAS"，部分方言写 "computed"/"generated always"。
// 这类列出现在 INSERT/UPDATE 列清单里会直接报错（MySQL 3105），
// 数据同步、复制表、造数等写路径都应统一按它过滤。
// 注意 MySQL 的 "DEFAULT_GENERATED" 只是默认值表达式，列仍可写，不算生成列。
func IsGeneratedColumnExtra(extra string) bool {
	normalized := strings.ToLower(strings.Join(strings.Fields(extra), " "))
	if normalized == "" {
		return false
	}
	for _, marker := range []string{
		"virtual generated",
		"stored generated",
		"generated always",
		"computed",
	} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	switch normalized {
	case "generated", "materialized", "alias":
		return true
	}
	return false
}
