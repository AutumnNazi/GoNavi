//go:build gonavi_full_drivers || gonavi_etcd_driver

package db

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// 数据浏览生成的 SELECT 子集：SELECT * | COUNT(*) | 列清单 FROM "<表路径>" [WHERE …] [ORDER BY 列 [ASC|DESC]] [LIMIT n] [OFFSET m]。
// 表是键前缀（完整路径），行是前缀下的键。WHERE 里 key 的等值、前缀 LIKE、范围条件下推为 etcd 范围查询，其余条件在客户端过滤。

const (
	etcdColumnKey            = "key"
	etcdColumnValue          = "value"
	etcdColumnCreateRevision = "create_revision"
	etcdColumnModRevision    = "mod_revision"
	etcdColumnVersion        = "version"
	etcdColumnLease          = "lease"
	etcdColumnTTL            = "ttl"
	etcdColumnDir            = "dir"
	etcdDefaultSelectLimit   = 500
	// etcdScanCap 是带客户端过滤或非键排序时最多扫描的键数，防止一次浏览拉全库。
	etcdScanCap = 200000
)

// etcdKeyValue 是一行键值：v3 的修订号、版本与租约，v2 的 TTL、是否目录与索引（映射到修订号列）。
type etcdKeyValue struct {
	key            string
	value          []byte
	createRevision int64
	modRevision    int64
	version        int64
	lease          int64
	ttl            int64
	dir            bool
}

// etcdSelect 是解析后的浏览查询。
type etcdSelect struct {
	table     string
	count     bool
	columns   []string
	where     interface{}
	orderBy   string
	desc      bool
	limit     int
	offset    int
	hasLimit  bool
	keyRanges []etcdKeyRange
	// residual 为 true 表示 WHERE 里有无法下推的条件，需要在客户端逐行过滤。
	residual bool
}

// etcdKeyRange 是半开区间 [start, end)；end 为空表示单个键（start 本身）。
type etcdKeyRange struct {
	start string
	end   string
}

var etcdSelectPattern = regexp.MustCompile(`(?is)^\s*select\s+(.+?)\s+from\s+("(?:[^"]|"")+"|[^\s;]+)`)

// parseEtcdSelect 解析浏览查询；表路径决定基础范围：路径本身 + 路径/ 开头的键。
func parseEtcdSelect(text, delimiter string) (etcdSelect, bool, error) {
	match := etcdSelectPattern.FindStringSubmatch(text)
	if match == nil {
		return etcdSelect{}, false, nil
	}
	query := etcdSelect{table: unquoteEtcdIdent(match[2])}
	projection := strings.TrimSpace(match[1])
	switch {
	case regexp.MustCompile(`(?i)^count\s*\(\s*\*\s*\)`).MatchString(projection):
		query.count = true
	case projection != "*":
		for _, column := range strings.Split(projection, ",") {
			if name := strings.ToLower(unquoteEtcdIdent(strings.TrimSpace(column))); name != "" {
				query.columns = append(query.columns, name)
			}
		}
	}
	clauses := splitRegistrySelectClauses(text, etcdDefaultSelectLimit)
	query.limit, query.offset, query.hasLimit = clauses.limit, clauses.offset, clauses.hasLimit
	if order := strings.TrimSpace(clauses.orderBy); order != "" {
		first := strings.TrimSpace(strings.Split(order, ",")[0])
		fields := strings.Fields(first)
		if len(fields) > 0 {
			query.orderBy = strings.ToLower(unquoteEtcdIdent(fields[0]))
			query.desc = len(fields) > 1 && strings.EqualFold(fields[len(fields)-1], "DESC")
		}
	}
	base := etcdTableRanges(query.table, delimiter)
	query.keyRanges = base
	if strings.TrimSpace(clauses.where) != "" {
		node, err := parseRegistryWhere(clauses.where)
		if err != nil {
			return etcdSelect{}, true, err
		}
		query.where = node
		ranges, residual := etcdPushdownKeyRanges(node)
		query.residual = residual
		if ranges != nil {
			query.keyRanges = intersectEtcdRanges(base, ranges)
		}
	}
	return query, true, nil
}

func unquoteEtcdIdent(text string) string {
	text = strings.TrimSpace(text)
	if len(text) >= 2 && text[0] == '"' && text[len(text)-1] == '"' {
		return strings.ReplaceAll(text[1:len(text)-1], `""`, `"`)
	}
	return text
}

// etcdTableRanges 是表路径对应的键：路径本身与 路径+分隔符 开头的键。
func etcdTableRanges(path, delimiter string) []etcdKeyRange {
	if path == "" {
		return []etcdKeyRange{{start: "", end: "\x00"}}
	}
	children := path + delimiter
	return []etcdKeyRange{{start: path}, {start: children, end: etcdPrefixEnd(children)}}
}

// etcdPushdownKeyRanges 从 WHERE 的顶层 AND 里取出 key 条件转成范围；返回 nil 表示没有可下推的条件。
// residual 报告是否还有条件需要客户端过滤（下推的条件同样保留在过滤里，结果仍然正确）。
func etcdPushdownKeyRanges(node interface{}) ([]etcdKeyRange, bool) {
	var conditions []interface{}
	if logical, ok := node.(registryWhereLogical); ok && logical.op == "And" {
		conditions = logical.operands
	} else {
		conditions = []interface{}{node}
	}
	var ranges []etcdKeyRange
	residual := false
	for _, operand := range conditions {
		condition, ok := operand.(registryWhereCondition)
		if !ok || !strings.EqualFold(condition.field, etcdColumnKey) {
			residual = true
			continue
		}
		next, exact := etcdConditionRanges(condition)
		if next == nil {
			residual = true
			continue
		}
		if !exact {
			residual = true
		}
		if ranges == nil {
			ranges = next
		} else {
			ranges = intersectEtcdRanges(ranges, next)
		}
	}
	return ranges, residual
}

// etcdConditionRanges 把单个 key 条件转成范围；exact 为 false 时范围只是上界近似，仍需过滤。
func etcdConditionRanges(condition registryWhereCondition) ([]etcdKeyRange, bool) {
	value := func(i int) string { return condition.values[i].text }
	switch condition.op {
	case "=":
		return []etcdKeyRange{{start: value(0)}}, true
	case "IN":
		ranges := make([]etcdKeyRange, 0, len(condition.values))
		for i := range condition.values {
			ranges = append(ranges, etcdKeyRange{start: value(i)})
		}
		return ranges, true
	case "LIKE":
		pattern := value(0)
		prefix := pattern
		if index := strings.IndexAny(pattern, "%_"); index >= 0 {
			prefix = pattern[:index]
		}
		if prefix == "" {
			return nil, false
		}
		if prefix == pattern {
			return []etcdKeyRange{{start: prefix}}, true
		}
		return []etcdKeyRange{{start: prefix, end: etcdPrefixEnd(prefix)}}, pattern == prefix+"%"
	case ">=":
		return []etcdKeyRange{{start: value(0), end: "\x00"}}, true
	case ">":
		return []etcdKeyRange{{start: value(0) + "\x00", end: "\x00"}}, true
	case "<":
		return []etcdKeyRange{{start: "", end: value(0)}}, true
	case "<=":
		return []etcdKeyRange{{start: "", end: value(0) + "\x00"}}, true
	case "BETWEEN":
		return []etcdKeyRange{{start: value(0), end: value(1) + "\x00"}}, true
	}
	return nil, false
}

// etcdRangeEnd 返回区间的结束键；单键区间返回 start + "\x00"。"\x00" 表示到键空间末尾。
func (r etcdKeyRange) rangeEnd() string {
	if r.end == "" {
		return r.start + "\x00"
	}
	return r.end
}

func etcdKeyLess(a, b string) bool {
	if b == "\x00" {
		return a != "\x00"
	}
	if a == "\x00" {
		return false
	}
	return a < b
}

// intersectEtcdRanges 求两组区间的交集，结果按起点排序。
func intersectEtcdRanges(left, right []etcdKeyRange) []etcdKeyRange {
	var result []etcdKeyRange
	for _, a := range left {
		for _, b := range right {
			start := a.start
			if b.start > start {
				start = b.start
			}
			end := a.rangeEnd()
			if etcdKeyLess(b.rangeEnd(), end) {
				end = b.rangeEnd()
			}
			if !etcdKeyLess(start, end) {
				continue
			}
			if end == start+"\x00" {
				result = append(result, etcdKeyRange{start: start})
			} else {
				result = append(result, etcdKeyRange{start: start, end: end})
			}
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].start < result[j].start })
	return result
}

// etcdRowValue 取一行在某列上的值，用于客户端过滤与排序。
func etcdRowValue(kv etcdKeyValue, column string) (string, int64, bool) {
	switch strings.ToLower(column) {
	case etcdColumnKey:
		return kv.key, 0, false
	case etcdColumnValue:
		return string(kv.value), 0, false
	case etcdColumnCreateRevision:
		return "", kv.createRevision, true
	case etcdColumnModRevision:
		return "", kv.modRevision, true
	case etcdColumnVersion:
		return "", kv.version, true
	case etcdColumnLease:
		return "", kv.lease, true
	case etcdColumnTTL:
		return "", kv.ttl, true
	}
	return "", 0, false
}

// matchEtcdWhere 在客户端求值 WHERE。
func matchEtcdWhere(node interface{}, kv etcdKeyValue) bool {
	switch typed := node.(type) {
	case nil:
		return true
	case registryWhereLogical:
		switch typed.op {
		case "Not":
			return !matchEtcdWhere(typed.operands[0], kv)
		case "Or":
			for _, operand := range typed.operands {
				if matchEtcdWhere(operand, kv) {
					return true
				}
			}
			return false
		default:
			for _, operand := range typed.operands {
				if !matchEtcdWhere(operand, kv) {
					return false
				}
			}
			return true
		}
	case registryWhereCondition:
		return matchEtcdCondition(typed, kv)
	}
	return false
}

func matchEtcdCondition(condition registryWhereCondition, kv etcdKeyValue) bool {
	text, number, numeric := etcdRowValue(kv, condition.field)
	compare := func(literal string) int {
		if numeric {
			parsed, err := parseEtcdNumber(literal)
			if err != nil {
				return strings.Compare(strconv.FormatInt(number, 10), literal)
			}
			switch {
			case number < parsed:
				return -1
			case number > parsed:
				return 1
			}
			return 0
		}
		return strings.Compare(text, literal)
	}
	values := condition.values
	switch condition.op {
	case "=":
		return compare(values[0].text) == 0
	case "!=":
		return compare(values[0].text) != 0
	case "<":
		return compare(values[0].text) < 0
	case "<=":
		return compare(values[0].text) <= 0
	case ">":
		return compare(values[0].text) > 0
	case ">=":
		return compare(values[0].text) >= 0
	case "BETWEEN", "NOT BETWEEN":
		inside := compare(values[0].text) >= 0 && compare(values[1].text) <= 0
		return inside == (condition.op == "BETWEEN")
	case "IN", "NOT IN":
		found := false
		for _, literal := range values {
			if compare(literal.text) == 0 {
				found = true
				break
			}
		}
		return found == (condition.op == "IN")
	case "LIKE", "NOT LIKE":
		subject := text
		if numeric {
			subject = strconv.FormatInt(number, 10)
		}
		return likeEtcdMatch(subject, values[0].text) == (condition.op == "LIKE")
	case "IS NULL":
		return !numeric && condition.field != etcdColumnKey && len(kv.value) == 0
	case "IS NOT NULL":
		return numeric || condition.field == etcdColumnKey || len(kv.value) > 0
	}
	return false
}

// parseEtcdNumber 接受十进制与十六进制（租约 ID 按 etcdctl 习惯显示为十六进制）。
func parseEtcdNumber(text string) (int64, error) {
	text = strings.TrimSpace(text)
	if value, err := strconv.ParseInt(text, 10, 64); err == nil {
		return value, nil
	}
	value, err := strconv.ParseUint(strings.TrimPrefix(strings.ToLower(text), "0x"), 16, 64)
	return int64(value), err
}

// likeEtcdMatch 实现 SQL LIKE（% 任意串、_ 单字符、反斜杠转义）。
func likeEtcdMatch(subject, pattern string) bool {
	var expression strings.Builder
	expression.WriteString("^(?s)")
	runes := []rune(pattern)
	for i := 0; i < len(runes); i++ {
		switch r := runes[i]; {
		case r == '\\' && i+1 < len(runes):
			i++
			expression.WriteString(regexp.QuoteMeta(string(runes[i])))
		case r == '%':
			expression.WriteString(".*")
		case r == '_':
			expression.WriteString(".")
		default:
			expression.WriteString(regexp.QuoteMeta(string(r)))
		}
	}
	expression.WriteString("$")
	matched, err := regexp.MatchString(expression.String(), subject)
	return err == nil && matched
}

// sortEtcdRows 按排序列在客户端排序（非键排序且需要过滤时使用）。
func sortEtcdRows(rows []etcdKeyValue, column string, desc bool) {
	sort.SliceStable(rows, func(i, j int) bool {
		leftText, leftNumber, numeric := etcdRowValue(rows[i], column)
		rightText, rightNumber, _ := etcdRowValue(rows[j], column)
		less := leftText < rightText
		if numeric {
			less = leftNumber < rightNumber
		}
		if desc {
			return !less && (leftText != rightText || leftNumber != rightNumber)
		}
		return less
	})
}
