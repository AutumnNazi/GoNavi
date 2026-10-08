package mockdata

import (
	"fmt"
	"slices"
	"strings"
)

// MaxReferenceSample 是外键引用从父表读取的取值上限：够随机分布，又不会把大表整表读回来。
const MaxReferenceSample = 1000

// DistinctSampleQuery 构造"读父表某列至多 limit 个不同非空值"的查询。table、column 须已按方言加好引号。
// 各族限制行数的写法不同：LIMIT、TOP、ROWNUM、FIRST。
func DistinctSampleQuery(family Family, table, column string, limit int) string {
	if limit <= 0 {
		limit = MaxReferenceSample
	}
	where := fmt.Sprintf("FROM %s WHERE %s IS NOT NULL", table, column)
	switch family {
	case FamilySQLServer, FamilyIRIS:
		return fmt.Sprintf("SELECT DISTINCT TOP %d %s %s", limit, column, where)
	case FamilyOracle:
		return fmt.Sprintf("SELECT %s FROM (SELECT DISTINCT %s %s) WHERE ROWNUM <= %d", column, column, where, limit)
	case FamilyFirebird, FamilyInformix:
		return fmt.Sprintf("SELECT FIRST %d DISTINCT %s %s", limit, column, where)
	}
	return fmt.Sprintf("SELECT DISTINCT %s %s LIMIT %d", column, where, limit)
}

// MaxValueQuery 构造读取列最大值的查询，用来让序列从 MAX+1 开始、不撞已有主键。
func MaxValueQuery(table, column string) string {
	return fmt.Sprintf("SELECT MAX(%s) FROM %s", column, table)
}

// PostgresEnumLabelsQuery 构造读取 PG 自定义枚举标签的查询；typeName 可带 schema 与引号。
func PostgresEnumLabelsQuery(typeName string) string {
	name := typeName
	if index := strings.LastIndex(name, "."); index >= 0 {
		name = name[index+1:]
	}
	name = strings.Trim(strings.TrimSpace(name), `"`)
	escaped := strings.ReplaceAll(name, "'", "''")
	return "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = '" +
		escaped + "' ORDER BY e.enumsortorder"
}

// NeedsEnumLookup 表示 PG 族的列类型没认出来，可能是自定义枚举，值得查一次 pg_enum。
func NeedsEnumLookup(profile Profile) bool {
	return profile.family == FamilyPostgres && profile.Category == CategoryUnsupported && !strings.Contains(profile.Type, "[")
}

// NeedsNextValue 表示整数主键/唯一列要按 MAX+1 起步，避免与已有数据冲突。
func NeedsNextValue(profile Profile) bool {
	if profile.AutoIncrement || profile.Computed || profile.ForeignKey != nil || !profile.Unique {
		return false
	}
	return profile.Category == CategoryInteger || (profile.Category == CategoryDecimal && profile.Scale == 0)
}

// NormalizeSample 把查询结果里的值转成生成器使用的文本，并排序，保证预览与写入的候选顺序一致。
func NormalizeSample(values []string) []string {
	result := slices.Clone(values)
	slices.Sort(result)
	return slices.Compact(result)
}
