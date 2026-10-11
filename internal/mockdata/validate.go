package mockdata

import (
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// validateLiteral 校验用户手填的固定值、候选值能否写进该列，避免跑到一半才被数据库拒绝。
func validateLiteral(in compileInput, text string) *PlanError {
	profile := in.profile
	switch profile.Category {
	case CategoryInteger, CategoryYear:
		value, ok := parseInt(text)
		if !ok {
			return in.fail(ErrCodeInvalidNumber, text)
		}
		return checkIntegerBounds(in, value)
	case CategoryDecimal, CategoryFloat:
		if _, err := strconv.ParseFloat(strings.TrimSpace(text), 64); err != nil {
			return in.fail(ErrCodeInvalidNumber, text)
		}
	case CategoryDate, CategoryTime, CategoryDateTime:
		if _, ok := parseTemporal(profile.Category, text); !ok {
			return in.fail(ErrCodeInvalidTemporal, text)
		}
	case CategoryBoolean:
		switch strings.ToLower(strings.TrimSpace(text)) {
		case "true", "false", "1", "0", "t", "f":
		default:
			return in.fail(ErrCodeInvalidNumber, text)
		}
	case CategoryUUID:
		if _, err := uuid.Parse(strings.TrimSpace(text)); err != nil {
			return in.fail(ErrCodeInvalidNumber, text)
		}
	case CategoryEnum:
		if len(profile.EnumValues) > 0 && !slices.Contains(profile.EnumValues, text) {
			return in.fail(ErrCodeValueNotInEnum, text)
		}
	case CategoryString, CategoryText:
		if profile.MaxLength > 0 && valueLength(text, profile.LengthInBytes) > profile.MaxLength {
			return in.fail(ErrCodeValueTooLong, text)
		}
		if profile.ASCIIOnly && !isASCII(text) {
			return in.fail(ErrCodeASCIIOnly, text)
		}
	}
	return nil
}

// checkIntegerBounds 校验整数是否落在列类型范围内；浮点列和不限精度的定点数不校验。
func checkIntegerBounds(in compileInput, value int64) *PlanError {
	profile := in.profile
	var low, high int64
	var ok bool
	switch profile.Category {
	case CategoryInteger, CategoryYear:
		var okLow, okHigh bool
		low, okLow = parseInt(profile.Min)
		high, okHigh = parseInt(profile.Max)
		ok = okLow && okHigh
	case CategoryDecimal:
		if profile.Max == "" {
			return nil
		}
		var okLow, okHigh bool
		low, okLow = truncateDecimalUnits(profile.Min, 0)
		high, okHigh = truncateDecimalUnits(profile.Max, 0)
		ok = okLow && okHigh
	default:
		return nil
	}
	if ok && (value < low || value > high) {
		return in.fail(ErrCodeOutOfTypeRange, profile.Min+" ~ "+profile.Max)
	}
	return nil
}

// checkTemporalBounds 校验日期区间是否落在列类型范围内（如 MySQL TIMESTAMP 只到 2038 年）。
func checkTemporalBounds(in compileInput, category Category, low, high time.Time) *PlanError {
	profile := in.profile
	if profile.Category != category || profile.Min == "" || profile.Max == "" {
		return nil
	}
	typeLow, okLow := parseTemporal(category, profile.Min)
	typeHigh, okHigh := parseTemporal(category, profile.Max)
	if okLow && okHigh && (low.Before(typeLow) || high.After(typeHigh)) {
		return in.fail(ErrCodeOutOfTypeRange, profile.Min+" ~ "+profile.Max)
	}
	return nil
}

func isASCII(text string) bool {
	for i := 0; i < len(text); i++ {
		if text[i] >= 0x80 {
			return false
		}
	}
	return true
}

// lengthCapacity 返回列最多能放多少个字符；中文在按字节计的列里按 UTF-8 三字节算。0 表示不限。
func lengthCapacity(profile Profile, wide bool) int {
	if profile.MaxLength <= 0 {
		return 0
	}
	if profile.LengthInBytes && wide {
		return profile.MaxLength / 3
	}
	return profile.MaxLength
}
