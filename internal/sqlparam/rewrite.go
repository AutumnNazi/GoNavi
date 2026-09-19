package sqlparam

import (
	"fmt"
	"sort"
	"strings"
)

// Dialect 是占位符方言。
type Dialect int

const (
	// DialectQmark 使用 ? 占位符（MySQL 系、SQLite、SQL Server、ClickHouse 等）。
	DialectQmark Dialect = iota
	// DialectDollar 使用 $1、$2 位置占位符（PostgreSQL 系）。
	DialectDollar
	// DialectOracle 使用 :1、:2 位置占位符（Oracle OCI/godror）。
	DialectOracle
)

// DialectForDBType 返回数据源对应的占位符方言。不支持的调用方按 Qmark 处理，
// 由能力声明层决定是否暴露参数功能。
func DialectForDBType(dbType string) Dialect {
	switch normalizeDBType(dbType) {
	case "oracle":
		return DialectOracle
	case "postgres", "opengauss", "gaussdb", "kingbase", "highgo", "vastbase":
		return DialectDollar
	default:
		return DialectQmark
	}
}

// BindResult 是一次成功绑定后的产物：重写后的 SQL 与按占位符顺序排列的参数值。
type BindResult struct {
	SQL  string
	Args []any
}

// Bind 扫描 sql 中的命名参数，用 values 的声明类型转换值，并按 dbType 对应的
// 占位符方言重写 SQL。
//
// 语义约定：
//   - 参数按名字取值，同名出现多次只绑定一次值（填一次、处处生效）；
//   - 列表参数的一个占位符展开为与元素数量相同的逗号分隔占位符（供 IN 使用，
//     圆括号由调用方 SQL 自带）；
//   - 未提供值的参数返回 ErrMissingParameter（包装具体参数名）；
//   - 不修改任何字符串字面量或注释；值永远通过 Args 绑定，绝不拼进 SQL。
func Bind(sql string, dbType string, values map[string]TypedValue) (BindResult, error) {
	opts := OptionsForDBType(dbType)
	spans := Scan(sql, opts)
	if len(spans) == 0 {
		return BindResult{SQL: sql}, nil
	}

	dialect := DialectForDBType(dbType)
	var out strings.Builder
	out.Grow(len(sql) + 8*len(spans))

	// convertedCache 避免同名参数重复转换。
	// Qmark 的 ? 是纯位置占位符：每次出现都要消耗一个参数值（同名重复出现时值重复追加）。
	// Dollar/Oracle 的占位符带序号：同名参数复用同一组槽位（填一次、处处生效）。
	convertedCache := make(map[string]any, len(values))
	nameSlots := make(map[string][]int, len(spans))
	nextSlot := 1
	slots := make(map[int]any)
	var qmarkArgs []any

	for spanIdx, span := range spans {
		out.WriteString(sql[between(spans, spanIdx):span.Start])

		converted, err := convertOnce(span.Name, values, convertedCache)
		if err != nil {
			return BindResult{}, err
		}
		items, isList := converted.([]any)

		if dialect == DialectQmark {
			for itemIdx := 0; itemIdx < len(items) || (itemIdx == 0 && !isList); itemIdx++ {
				if itemIdx > 0 {
					out.WriteByte(',')
				}
				out.WriteByte('?')
				if isList {
					qmarkArgs = append(qmarkArgs, items[itemIdx])
				} else {
					qmarkArgs = append(qmarkArgs, converted)
				}
			}
			continue
		}

		spanSlots, ok := nameSlots[span.Name]
		if !ok {
			if isList {
				spanSlots = make([]int, 0, len(items))
				for range items {
					spanSlots = append(spanSlots, nextSlot)
					nextSlot++
				}
			} else {
				spanSlots = []int{nextSlot}
				nextSlot++
			}
			nameSlots[span.Name] = spanSlots
		}

		marker := "$"
		if dialect == DialectOracle {
			marker = ":"
		}
		for slotIdx, slot := range spanSlots {
			if slotIdx > 0 {
				out.WriteByte(',')
			}
			fmt.Fprintf(&out, "%s%d", marker, slot)
			if _, assigned := slots[slot]; !assigned {
				if isList {
					slots[slot] = items[slotIdx]
				} else {
					slots[slot] = converted
				}
			}
		}
	}
	out.WriteString(sql[spans[len(spans)-1].End:])

	if dialect == DialectQmark {
		return BindResult{SQL: out.String(), Args: qmarkArgs}, nil
	}
	args := make([]any, nextSlot-1)
	for slot, value := range slots {
		args[slot-1] = value
	}
	return BindResult{SQL: out.String(), Args: args}, nil
}

func between(spans []Span, idx int) int {
	if idx == 0 {
		return 0
	}
	return spans[idx-1].End
}

// convertOnce 转换并缓存单个参数的值；缺值返回包装了参数名的 ErrMissingParameter。
func convertOnce(name string, values map[string]TypedValue, cache map[string]any) (any, error) {
	if cached, ok := cache[name]; ok {
		return cached, nil
	}
	typed, provided := values[name]
	if !provided {
		return nil, fmt.Errorf("%w：%s", ErrMissingParameter, name)
	}
	converted, err := ConvertTypedValue(typed.Type, typed.Value)
	if err != nil {
		return nil, fmt.Errorf("参数 %s：%w", name, err)
	}
	cache[name] = converted
	return converted, nil
}

// MissingParameterNames 返回扫描到但未提供值的参数名（排序去重），供上层生成
// 可操作的错误提示。
func MissingParameterNames(sql string, dbType string, values map[string]TypedValue) []string {
	opts := OptionsForDBType(dbType)
	var missing []string
	seen := make(map[string]struct{})
	for _, span := range Scan(sql, opts) {
		if _, ok := values[span.Name]; ok {
			continue
		}
		if _, ok := seen[span.Name]; ok {
			continue
		}
		seen[span.Name] = struct{}{}
		missing = append(missing, span.Name)
	}
	sort.Strings(missing)
	return missing
}
