package mockdata

import (
	"math/rand/v2"
	"slices"
	"strconv"
	"strings"
)

// maxUniqueAttempts 是唯一列随机取值撞车后的重试次数；取值范围足够宽时几乎不会用满。
const maxUniqueAttempts = 100

// References 是外键列可选的父表取值，键为小写列名。
type References map[string][]string

// Producer 按计划逐行产出数据，同一计划多次运行结果相同。不可并发使用。
type Producer struct {
	columns []*compiledColumn
	names   []string
	total   int
	row     int
}

type uniqueMode int

const (
	uniqueNone uniqueMode = iota
	uniqueByConstruction
	uniqueByShuffle
	uniqueBySuffix
	uniqueByRetry
)

type compiledColumn struct {
	name      string
	kind      Kind
	rng       randSource
	nullRatio float64
	value     valueFunc
	unique    uniqueMode
	seen      map[string]struct{}
	maxLength int
	inBytes   bool
}

// NewProducer 校验计划并编译每列的生成规则。profiles 是表上全部列的画像。
func NewProducer(plan Plan, profiles []Profile, refs References) (*Producer, error) {
	if plan.RowCount < 1 || plan.RowCount > MaxRowCount {
		return nil, planError(ErrCodeRowCount, "", strconv.Itoa(MaxRowCount))
	}
	planned, err := matchColumnPlans(plan.Columns, profiles)
	if err != nil {
		return nil, err
	}
	producer := &Producer{total: plan.RowCount}
	for index, profile := range profiles {
		columnPlan, ok := planned[index]
		if !ok {
			columnPlan = ColumnPlan{Name: profile.Name, Skip: true}
		}
		column, err := compileColumn(plan, profile, columnPlan, refs[strings.ToLower(profile.Name)])
		if err != nil {
			return nil, err
		}
		if column == nil {
			continue
		}
		producer.columns = append(producer.columns, column)
		producer.names = append(producer.names, profile.Name)
	}
	if len(producer.columns) == 0 {
		return nil, planError(ErrCodeNoColumns, "", "")
	}
	return producer, nil
}

// matchColumnPlans 把计划里的列对到画像下标；列名先精确匹配，再忽略大小写。
func matchColumnPlans(plans []ColumnPlan, profiles []Profile) (map[int]ColumnPlan, error) {
	matched := make(map[int]ColumnPlan, len(plans))
	for _, columnPlan := range plans {
		index := profileIndex(profiles, columnPlan.Name)
		if index < 0 {
			return nil, planError(ErrCodeUnknownColumn, columnPlan.Name, "")
		}
		if _, exists := matched[index]; exists {
			return nil, planError(ErrCodeDuplicateColumn, columnPlan.Name, "")
		}
		matched[index] = columnPlan
	}
	return matched, nil
}

// compileColumn 返回 nil 表示该列跳过、交给数据库默认值或自增。
func compileColumn(plan Plan, profile Profile, columnPlan ColumnPlan, refs []string) (*compiledColumn, error) {
	if columnPlan.Skip {
		if profile.Required() {
			return nil, planError(ErrCodeRequiredSkipped, profile.Name, "")
		}
		return nil, nil
	}
	if profile.Computed {
		return nil, planError(ErrCodeComputedColumn, profile.Name, "")
	}
	ratio := columnPlan.NullRatio
	if ratio < 0 || ratio > 1 {
		return nil, planError(ErrCodeNullRatioOutOfRange, profile.Name, "")
	}
	if ratio > 0 && (!profile.Nullable || profile.Unique) {
		return nil, planError(ErrCodeNullNotAllowed, profile.Name, "")
	}
	input := compileInput{profile: profile, gen: columnPlan.Generator, locale: plan.Locale, rowCount: plan.RowCount, refs: refs}
	value, planErr := compileGenerator(input)
	if planErr != nil {
		return nil, planErr
	}
	column := &compiledColumn{
		name:      profile.Name,
		kind:      columnPlan.Generator.Kind,
		rng:       rand.New(rand.NewPCG(uint64(plan.Seed), columnSeed(profile.Name))),
		nullRatio: ratio,
		value:     value,
		unique:    resolveUniqueMode(profile, columnPlan.Generator.Kind),
	}
	if profile.Category == CategoryString || profile.Category == CategoryText {
		column.maxLength, column.inBytes = profile.MaxLength, profile.LengthInBytes
	}
	if column.unique == uniqueByShuffle {
		// 候选为空时（父表无数据但列可空）保留原取值函数，它会一直出 NULL。
		if candidates := uniqueCandidates(profile, columnPlan.Generator, refs); len(candidates) > 0 {
			column.value = shuffledValues(candidates)
		}
	}
	if column.unique == uniqueBySuffix || column.unique == uniqueByRetry {
		column.seen = make(map[string]struct{}, min(plan.RowCount, 1<<16))
	}
	return column, nil
}

// columnSeed 用 FNV-1a 把列名散列成随机流编号，让每列的随机序列互不相关且与列顺序无关。
func columnSeed(name string) uint64 {
	const offset, prime = 14695981039346656037, 1099511628211
	hash := uint64(offset)
	for _, b := range []byte(strings.ToLower(name)) {
		hash ^= uint64(b)
		hash *= prime
	}
	return hash
}

func resolveUniqueMode(profile Profile, kind Kind) uniqueMode {
	if !profile.Unique {
		return uniqueNone
	}
	switch kind {
	case KindSequence, KindDateTimeSequence, KindUUID, KindNull, KindJSON:
		return uniqueByConstruction
	case KindList, KindEnum, KindReference:
		if profile.Category == CategorySet {
			return uniqueByRetry
		}
		return uniqueByShuffle
	case KindPersonName, KindUsername, KindEmail, KindCompany, KindCity, KindProvince, KindAddress, KindURL, KindText:
		return uniqueBySuffix
	}
	return uniqueByRetry
}

// uniqueCandidates 列出候选值有限的规则（列表、枚举、父表引用）去重后的全部取值。
func uniqueCandidates(profile Profile, gen Generator, refs []string) []string {
	source := gen.Values
	switch gen.Kind {
	case KindEnum:
		if len(source) == 0 {
			source = profile.EnumValues
		}
	case KindReference:
		source = refs
	}
	candidates := make([]string, 0, len(source))
	seen := make(map[string]struct{}, len(source))
	for _, value := range source {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		candidates = append(candidates, value)
	}
	return candidates
}

// shuffledValues 让候选值有限的唯一列按打乱后的顺序逐行取，不靠随机撞运气。
// 首次调用发生在第 0 行，随机流状态在预览与写入时一致，所以顺序也一致。
func shuffledValues(candidates []string) valueFunc {
	var order []string
	return func(rng randSource, row int) (string, bool) {
		if order == nil {
			order = slices.Clone(candidates)
			rng.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })
		}
		return order[row%len(order)], false
	}
}

// Columns 返回会写入的列名，顺序与表定义一致。
func (p *Producer) Columns() []string {
	return slices.Clone(p.names)
}

// Total 返回计划行数。
func (p *Producer) Total() int {
	return p.total
}

// Next 产出下一行；全部产出后返回 nil, false。
func (p *Producer) Next() (map[string]interface{}, bool, error) {
	if p.row >= p.total {
		return nil, false, nil
	}
	row := make(map[string]interface{}, len(p.columns))
	for _, column := range p.columns {
		value, null, err := column.next(p.row)
		if err != nil {
			return nil, false, err
		}
		if null {
			row[column.name] = nil
			continue
		}
		row[column.name] = value
	}
	p.row++
	return row, true, nil
}

func (c *compiledColumn) next(row int) (string, bool, error) {
	if c.nullRatio > 0 && c.rng.Float64() < c.nullRatio {
		return "", true, nil
	}
	for attempt := 0; attempt < maxUniqueAttempts; attempt++ {
		value, null := c.value(c.rng, row)
		if null {
			return "", true, nil
		}
		if c.unique == uniqueBySuffix {
			value = appendUniqueSuffix(c.kind, value, row, c.maxLength, c.inBytes)
		} else {
			value = fitLength(value, c.maxLength, c.inBytes)
		}
		if c.seen == nil {
			return value, false, nil
		}
		if _, exists := c.seen[value]; !exists {
			c.seen[value] = struct{}{}
			return value, false, nil
		}
	}
	return "", false, planError(ErrCodeUniqueExhausted, c.name, strconv.Itoa(row+1))
}

// appendUniqueSuffix 给词库类取值加上行号，保证唯一；邮箱加在 @ 前，截断时先截原值保住行号。
func appendUniqueSuffix(kind Kind, value string, row, maxLength int, inBytes bool) string {
	suffix := strconv.Itoa(row + 1)
	if kind == KindEmail {
		if local, domain, ok := strings.Cut(value, "@"); ok {
			tail := suffix + "@" + domain
			return fitLength(local, remaining(maxLength, tail), inBytes) + tail
		}
	}
	return fitLength(value, remaining(maxLength, suffix), inBytes) + suffix
}

func remaining(maxLength int, tail string) int {
	if maxLength <= 0 {
		return 0
	}
	return max(maxLength-len(tail), 1)
}
