package mockdata

import (
	"math/rand/v2"
	"slices"
	"strconv"
	"strings"
	"time"
)

// randSource 是每列独立的确定性随机流。
type randSource = *rand.Rand

// valueFunc 产出第 row 行（从 0 起）的值；null 为 true 时写 NULL。
type valueFunc func(rng randSource, row int) (value string, null bool)

// compileInput 是编译一列生成规则所需的上下文。
type compileInput struct {
	profile  Profile
	gen      Generator
	locale   string
	rowCount int
	refs     []string
}

func (in compileInput) fail(code, detail string) *PlanError {
	return planError(code, in.profile.Name, detail)
}

func constant(value string) valueFunc {
	return func(randSource, int) (string, bool) { return value, false }
}

// compileGenerator 校验规则并返回取值函数。语义类规则在 compileSemantic 里。
func compileGenerator(in compileInput) (valueFunc, *PlanError) {
	if !kindAllowed(in.profile.Category, in.gen.Kind) {
		return nil, in.fail(ErrCodeKindNotAllowed, string(in.gen.Kind))
	}
	switch in.gen.Kind {
	case KindNull:
		if !in.profile.Nullable {
			return nil, in.fail(ErrCodeNullNotAllowed, "")
		}
		return func(randSource, int) (string, bool) { return "", true }, nil
	case KindFixed:
		if err := validateLiteral(in, in.gen.Value); err != nil {
			return nil, err
		}
		return constant(in.gen.Value), nil
	case KindList:
		return compileList(in, in.gen.Values)
	case KindEnum:
		return compileEnum(in)
	case KindSequence:
		return compileSequence(in)
	case KindIntRange:
		return compileIntRange(in)
	case KindDecimalRange:
		return compileDecimalRange(in)
	case KindBoolean:
		return compileBoolean(in)
	case KindBits:
		return compileBits(in), nil
	case KindUUID:
		return compileUUID(in)
	case KindDateRange, KindTimeRange, KindDateTimeRange:
		return compileTemporalRange(in)
	case KindDateTimeSequence:
		return compileDateTimeSequence(in)
	case KindReference:
		return compileReference(in)
	}
	return compileSemantic(in)
}

func compileList(in compileInput, values []string) (valueFunc, *PlanError) {
	if len(values) == 0 {
		return nil, in.fail(ErrCodeEmptyValues, "")
	}
	for _, value := range values {
		if err := validateLiteral(in, value); err != nil {
			return nil, err
		}
	}
	if in.profile.Unique && distinctCount(values) < in.rowCount {
		return nil, in.fail(ErrCodeUniqueDomain, strconv.Itoa(distinctCount(values)))
	}
	options := slices.Clone(values)
	return func(rng randSource, _ int) (string, bool) { return pick(rng, options), false }, nil
}

func compileEnum(in compileInput) (valueFunc, *PlanError) {
	labels := in.gen.Values
	if len(labels) == 0 {
		labels = in.profile.EnumValues
	}
	if len(labels) == 0 {
		return nil, in.fail(ErrCodeEmptyValues, "")
	}
	if len(in.profile.EnumValues) > 0 {
		for _, label := range labels {
			if !slices.Contains(in.profile.EnumValues, label) {
				return nil, in.fail(ErrCodeValueNotInEnum, label)
			}
		}
	}
	options := slices.Clone(labels)
	if in.profile.Category != CategorySet {
		if in.profile.Unique && distinctCount(options) < in.rowCount {
			return nil, in.fail(ErrCodeUniqueDomain, strconv.Itoa(distinctCount(options)))
		}
		return func(rng randSource, _ int) (string, bool) { return pick(rng, options), false }, nil
	}
	return func(rng randSource, _ int) (string, bool) {
		chosen := make([]string, 0, len(options))
		for _, label := range options {
			if rng.IntN(2) == 0 {
				chosen = append(chosen, label)
			}
		}
		if len(chosen) == 0 {
			chosen = append(chosen, pick(rng, options))
		}
		return strings.Join(chosen, ","), false
	}, nil
}

func compileSequence(in compileInput) (valueFunc, *PlanError) {
	start, ok := parseInt(defaultText(in.gen.Start, "1"))
	if !ok {
		return nil, in.fail(ErrCodeInvalidNumber, in.gen.Start)
	}
	step, ok := parseInt(defaultText(in.gen.Step, "1"))
	if !ok {
		return nil, in.fail(ErrCodeInvalidNumber, in.gen.Step)
	}
	if step == 0 {
		return nil, in.fail(ErrCodeSequenceStepZero, "")
	}
	last, overflow := sequenceValue(start, step, in.rowCount-1)
	if overflow {
		return nil, in.fail(ErrCodeOutOfTypeRange, "")
	}
	if isNumericCategory(in.profile.Category) {
		if err := checkIntegerBounds(in, start); err != nil {
			return nil, err
		}
		if err := checkIntegerBounds(in, last); err != nil {
			return nil, err
		}
		return func(_ randSource, row int) (string, bool) {
			value, _ := sequenceValue(start, step, row)
			return formatInt(value), false
		}, nil
	}
	width := max(in.gen.Width, 0)
	format := func(value int64) string {
		digits := formatInt(value)
		if len(digits) < width && value >= 0 {
			digits = strings.Repeat("0", width-len(digits)) + digits
		}
		return in.gen.Prefix + digits
	}
	if limit := in.profile.MaxLength; limit > 0 && valueLength(format(last), in.profile.LengthInBytes) > limit {
		return nil, in.fail(ErrCodeValueTooLong, format(last))
	}
	return func(_ randSource, row int) (string, bool) {
		value, _ := sequenceValue(start, step, row)
		return format(value), false
	}, nil
}

// sequenceValue 计算 start + row*step，溢出时返回 true。
func sequenceValue(start, step int64, row int) (int64, bool) {
	offset := step * int64(row)
	if row != 0 && offset/int64(row) != step {
		return 0, true
	}
	value := start + offset
	if (offset > 0 && value < start) || (offset < 0 && value > start) {
		return 0, true
	}
	return value, false
}

func compileIntRange(in compileInput) (valueFunc, *PlanError) {
	low, ok := parseInt(in.gen.Min)
	if !ok {
		return nil, in.fail(ErrCodeInvalidNumber, in.gen.Min)
	}
	high, ok := parseInt(in.gen.Max)
	if !ok {
		return nil, in.fail(ErrCodeInvalidNumber, in.gen.Max)
	}
	if low > high {
		return nil, in.fail(ErrCodeInvalidRange, "")
	}
	if err := checkIntegerBounds(in, low); err != nil {
		return nil, err
	}
	if err := checkIntegerBounds(in, high); err != nil {
		return nil, err
	}
	if in.profile.Unique && uint64(high)-uint64(low) < uint64(in.rowCount-1) {
		return nil, in.fail(ErrCodeUniqueDomain, formatInt(high-low+1))
	}
	return func(rng randSource, _ int) (string, bool) { return formatInt(randomInt64(rng, low, high)), false }, nil
}

func compileDecimalRange(in compileInput) (valueFunc, *PlanError) {
	scale := max(in.gen.Scale, 0)
	if in.profile.Category == CategoryDecimal && in.profile.Precision > 0 {
		scale = min(scale, in.profile.Scale)
	}
	low, ok := parseDecimalUnits(in.gen.Min, scale)
	if !ok {
		return nil, in.fail(ErrCodeInvalidNumber, in.gen.Min)
	}
	high, ok := parseDecimalUnits(in.gen.Max, scale)
	if !ok {
		return nil, in.fail(ErrCodeInvalidNumber, in.gen.Max)
	}
	if low > high {
		return nil, in.fail(ErrCodeInvalidRange, "")
	}
	if in.profile.Max != "" {
		typeHigh, okHigh := truncateDecimalUnits(in.profile.Max, scale)
		typeLow, okLow := truncateDecimalUnits(in.profile.Min, scale)
		if okHigh && okLow && (low < typeLow || high > typeHigh) {
			return nil, in.fail(ErrCodeOutOfTypeRange, in.profile.Min+" ~ "+in.profile.Max)
		}
	}
	if in.profile.Unique && uint64(high)-uint64(low) < uint64(in.rowCount-1) {
		return nil, in.fail(ErrCodeUniqueDomain, "")
	}
	return func(rng randSource, _ int) (string, bool) {
		return formatDecimalUnits(randomInt64(rng, low, high), scale), false
	}, nil
}

func compileBoolean(in compileInput) (valueFunc, *PlanError) {
	ratio := in.gen.Ratio
	if ratio <= 0 || ratio > 1 {
		ratio = 0.5
	}
	trueText, falseText := in.profile.family.booleanLiterals()
	if in.profile.Category == CategoryBit {
		trueText, falseText = "1", "0"
	}
	if in.profile.Unique && in.rowCount > 2 {
		return nil, in.fail(ErrCodeUniqueDomain, "2")
	}
	return func(rng randSource, _ int) (string, bool) {
		if rng.Float64() < ratio {
			return trueText, false
		}
		return falseText, false
	}, nil
}

func compileBits(in compileInput) valueFunc {
	width := max(in.profile.MaxLength, 1)
	return func(rng randSource, _ int) (string, bool) {
		bits := make([]byte, width)
		for i := range bits {
			bits[i] = byte('0' + rng.IntN(2))
		}
		return string(bits), false
	}
}

func compileUUID(in compileInput) (valueFunc, *PlanError) {
	length := 36
	if in.gen.Compact {
		length = 32
	}
	if limit := in.profile.MaxLength; limit > 0 && limit < length {
		return nil, in.fail(ErrCodeInvalidLength, strconv.Itoa(limit))
	}
	compact := in.gen.Compact
	return func(rng randSource, _ int) (string, bool) { return randomUUID(rng, compact), false }, nil
}

func compileReference(in compileInput) (valueFunc, *PlanError) {
	if len(in.refs) == 0 {
		if !in.profile.Nullable {
			return nil, in.fail(ErrCodeReferenceEmpty, "")
		}
		return func(randSource, int) (string, bool) { return "", true }, nil
	}
	if in.profile.Unique && len(in.refs) < in.rowCount {
		return nil, in.fail(ErrCodeUniqueDomain, strconv.Itoa(len(in.refs)))
	}
	values := slices.Clone(in.refs)
	return func(rng randSource, _ int) (string, bool) { return pick(rng, values), false }, nil
}

func compileTemporalRange(in compileInput) (valueFunc, *PlanError) {
	category := temporalCategoryOf(in.gen.Kind)
	low, ok := parseTemporal(category, in.gen.Min)
	if !ok {
		return nil, in.fail(ErrCodeInvalidTemporal, in.gen.Min)
	}
	high, ok := parseTemporal(category, in.gen.Max)
	if !ok {
		return nil, in.fail(ErrCodeInvalidTemporal, in.gen.Max)
	}
	if low.After(high) {
		return nil, in.fail(ErrCodeInvalidRange, "")
	}
	if err := checkTemporalBounds(in, category, low, high); err != nil {
		return nil, err
	}
	unit := int64(time.Second)
	if category == CategoryDate {
		unit = int64(24 * time.Hour)
	}
	span := (high.UnixNano() - low.UnixNano()) / unit
	if in.profile.Unique && span+1 < int64(in.rowCount) {
		return nil, in.fail(ErrCodeUniqueDomain, formatInt(span+1))
	}
	return func(rng randSource, _ int) (string, bool) {
		offset := randomInt64(rng, 0, span)
		return formatTemporal(category, low.Add(time.Duration(offset*unit))), false
	}, nil
}

func compileDateTimeSequence(in compileInput) (valueFunc, *PlanError) {
	start, ok := parseTemporal(CategoryDateTime, in.gen.Start)
	if !ok {
		return nil, in.fail(ErrCodeInvalidTemporal, in.gen.Start)
	}
	step, ok := parseInt(defaultText(in.gen.Step, "1"))
	if !ok {
		return nil, in.fail(ErrCodeInvalidNumber, in.gen.Step)
	}
	if step == 0 {
		return nil, in.fail(ErrCodeSequenceStepZero, "")
	}
	last := start.Add(time.Duration(step*int64(in.rowCount-1)) * time.Second)
	low, high := start, last
	if step < 0 {
		low, high = last, start
	}
	if err := checkTemporalBounds(in, CategoryDateTime, low, high); err != nil {
		return nil, err
	}
	return func(_ randSource, row int) (string, bool) {
		return formatTemporal(CategoryDateTime, start.Add(time.Duration(step*int64(row))*time.Second)), false
	}, nil
}

func temporalCategoryOf(kind Kind) Category {
	switch kind {
	case KindDateRange:
		return CategoryDate
	case KindTimeRange:
		return CategoryTime
	}
	return CategoryDateTime
}

func distinctCount(values []string) int {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		seen[value] = struct{}{}
	}
	return len(seen)
}

func defaultText(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func isNumericCategory(category Category) bool {
	switch category {
	case CategoryInteger, CategoryDecimal, CategoryFloat, CategoryYear:
		return true
	}
	return false
}
