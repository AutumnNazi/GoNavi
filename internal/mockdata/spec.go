package mockdata

import (
	"fmt"
	"slices"
)

// Kind 是生成规则种类。
type Kind string

// 生成规则种类。语义类按 Generator.Locale 出中文或英文。
const (
	KindNull             Kind = "null"
	KindFixed            Kind = "fixed"
	KindSequence         Kind = "sequence"
	KindIntRange         Kind = "int_range"
	KindDecimalRange     Kind = "decimal_range"
	KindRandomString     Kind = "random_string"
	KindText             Kind = "text"
	KindList             Kind = "list"
	KindEnum             Kind = "enum"
	KindBoolean          Kind = "boolean"
	KindBits             Kind = "bits"
	KindUUID             Kind = "uuid"
	KindDateRange        Kind = "date_range"
	KindTimeRange        Kind = "time_range"
	KindDateTimeRange    Kind = "datetime_range"
	KindDateTimeSequence Kind = "datetime_sequence"
	KindReference        Kind = "reference"
	KindJSON             Kind = "json"
	KindPersonName       Kind = "person_name"
	KindUsername         Kind = "username"
	KindEmail            Kind = "email"
	KindPhone            Kind = "phone"
	KindProvince         Kind = "province"
	KindCity             Kind = "city"
	KindAddress          Kind = "address"
	KindCompany          Kind = "company"
	KindURL              Kind = "url"
	KindIPv4             Kind = "ipv4"
)

// 字符集，用于 random_string。
const (
	CharsetAlnum = "alnum"
	CharsetAlpha = "alpha"
	CharsetLower = "lower"
	CharsetUpper = "upper"
	// CharsetUpperDigits 是大写字母加数字，适合编号类列。
	CharsetUpperDigits = "upper_digits"
	CharsetDigits      = "digits"
	CharsetHex         = "hex"
	CharsetChinese     = "chinese"
)

// 语言。
const (
	LocaleZH = "zh"
	LocaleEN = "en"
)

// 行数上限与预览行数。
const (
	MaxRowCount     = 1_000_000
	PreviewRowCount = 20
)

// Generator 描述一列怎么出值。数值与日期一律用文本传递，避免前端 number 精度和时区换算。
type Generator struct {
	Kind Kind `json:"kind"`
	// Value 是 fixed 的固定值。
	Value string `json:"value,omitempty"`
	// Values 是 list 的候选值；enum 为空时取列定义里的枚举标签。
	Values []string `json:"values,omitempty"`
	// Min/Max 是区间规则的上下界：整数、小数、日期（2006-01-02）、时间（15:04:05）、日期时间（2006-01-02 15:04:05）。
	Min string `json:"min,omitempty"`
	Max string `json:"max,omitempty"`
	// Start/Step 是 sequence 与 datetime_sequence 的起点和步长（datetime_sequence 的步长单位为秒）。
	Start string `json:"start,omitempty"`
	Step  string `json:"step,omitempty"`
	// Prefix/Width 让字符串列的 sequence 输出 "ORD000123" 这类编号。
	Prefix string `json:"prefix,omitempty"`
	Width  int    `json:"width,omitempty"`
	// Scale 是 decimal_range 的小数位。
	Scale     int    `json:"scale,omitempty"`
	MinLength int    `json:"minLength,omitempty"`
	MaxLength int    `json:"maxLength,omitempty"`
	Charset   string `json:"charset,omitempty"`
	// Ratio 是 boolean 取真的比例（0~1），为 0 时按 0.5。
	Ratio  float64 `json:"ratio,omitempty"`
	Locale string  `json:"locale,omitempty"`
	// Compact 让 uuid 输出不带连字符的 32 位十六进制。
	Compact bool `json:"compact,omitempty"`
}

// ColumnPlan 是一列的生成设置。
type ColumnPlan struct {
	Name      string    `json:"name"`
	Skip      bool      `json:"skip"`
	NullRatio float64   `json:"nullRatio,omitempty"`
	Generator Generator `json:"generator"`
}

// Plan 是一次生成的完整设置。同一 Plan（含 Seed）产出的数据完全相同，预览即实际写入的前几行。
type Plan struct {
	RowCount int          `json:"rowCount"`
	Seed     int64        `json:"seed"`
	Locale   string       `json:"locale,omitempty"`
	Columns  []ColumnPlan `json:"columns"`
}

// PlanError 是可展示给用户的计划错误；Code 由绑定层翻译成 mock_data.backend.error.<code>。
type PlanError struct {
	Code   string
	Column string
	Detail string
}

// 计划错误码。
const (
	ErrCodeRowCount            = "row_count_out_of_range"
	ErrCodeNoColumns           = "no_columns"
	ErrCodeUnknownColumn       = "unknown_column"
	ErrCodeDuplicateColumn     = "duplicate_column"
	ErrCodeComputedColumn      = "computed_column"
	ErrCodeRequiredSkipped     = "required_column_skipped"
	ErrCodeNullNotAllowed      = "null_not_allowed"
	ErrCodeKindNotAllowed      = "generator_not_allowed"
	ErrCodeInvalidNumber       = "invalid_number"
	ErrCodeInvalidTemporal     = "invalid_temporal"
	ErrCodeInvalidRange        = "invalid_range"
	ErrCodeOutOfTypeRange      = "out_of_type_range"
	ErrCodeEmptyValues         = "empty_values"
	ErrCodeReferenceEmpty      = "reference_empty"
	ErrCodeUniqueDomain        = "unique_domain_too_small"
	ErrCodeUniqueExhausted     = "unique_exhausted"
	ErrCodeValueTooLong        = "value_too_long"
	ErrCodeInvalidLength       = "invalid_length"
	ErrCodeSequenceStepZero    = "sequence_step_zero"
	ErrCodeNullRatioOutOfRange = "null_ratio_out_of_range"
	ErrCodeValueNotInEnum      = "value_not_in_enum"
	ErrCodeASCIIOnly           = "ascii_only_column"
)

func (e *PlanError) Error() string {
	if e.Column == "" {
		return fmt.Sprintf("mock data plan: %s", e.Code)
	}
	return fmt.Sprintf("mock data plan: %s (column %s)", e.Code, e.Column)
}

func planError(code, column, detail string) *PlanError {
	return &PlanError{Code: code, Column: column, Detail: detail}
}

// AllowedKinds 列出某类别可用的生成规则，前端据此出下拉选项，后端据此校验。
func AllowedKinds(category Category) []Kind {
	common := []Kind{KindFixed, KindList, KindNull}
	switch category {
	case CategoryInteger:
		return append([]Kind{KindSequence, KindIntRange, KindReference}, common...)
	case CategoryDecimal:
		return append([]Kind{KindSequence, KindDecimalRange, KindIntRange, KindReference}, common...)
	case CategoryFloat:
		return append([]Kind{KindDecimalRange, KindIntRange, KindReference}, common...)
	case CategoryString, CategoryText:
		return append([]Kind{
			KindRandomString, KindText, KindPersonName, KindUsername, KindEmail, KindPhone, KindProvince,
			KindCity, KindAddress, KindCompany, KindURL, KindIPv4, KindUUID, KindSequence, KindJSON,
			KindDateRange, KindDateTimeRange, KindReference,
		}, common...)
	case CategoryBoolean:
		return append([]Kind{KindBoolean}, common...)
	case CategoryDate:
		return append([]Kind{KindDateRange, KindReference}, common...)
	case CategoryTime:
		return append([]Kind{KindTimeRange}, common...)
	case CategoryDateTime:
		return append([]Kind{KindDateTimeRange, KindDateTimeSequence, KindReference}, common...)
	case CategoryYear:
		return append([]Kind{KindIntRange}, common...)
	case CategoryUUID:
		return append([]Kind{KindUUID, KindReference}, common...)
	case CategoryJSON:
		return append([]Kind{KindJSON}, common...)
	case CategoryEnum, CategorySet:
		return append([]Kind{KindEnum}, common...)
	case CategoryBit:
		return append([]Kind{KindBits, KindBoolean}, common...)
	case CategoryInet:
		return append([]Kind{KindIPv4}, common...)
	}
	return []Kind{KindFixed, KindNull}
}

func kindAllowed(category Category, kind Kind) bool {
	return slices.Contains(AllowedKinds(category), kind)
}
