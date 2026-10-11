package mockdata

import (
	"strings"

	"GoNavi-Wails/internal/connection"
)

// ForeignKey 是列引用的父表列。
type ForeignKey struct {
	Table  string `json:"table"`
	Column string `json:"column"`
}

// TableKeys 汇总表上的约束，由绑定层从索引与外键元数据组装。
type TableKeys struct {
	PrimaryKey []string
	Unique     [][]string
	// ForeignKeys 的键是小写列名。
	ForeignKeys map[string]ForeignKey
}

// Profile 是生成规则需要知道的列信息，由 ClassifyTable 从元数据推出。
type Profile struct {
	Name          string      `json:"name"`
	Type          string      `json:"type"`
	Comment       string      `json:"comment,omitempty"`
	Category      Category    `json:"category"`
	Nullable      bool        `json:"nullable"`
	HasDefault    bool        `json:"hasDefault"`
	AutoIncrement bool        `json:"autoIncrement"`
	Computed      bool        `json:"computed"`
	PrimaryKey    bool        `json:"primaryKey"`
	Unique        bool        `json:"unique"`
	MaxLength     int         `json:"maxLength,omitempty"`
	LengthInBytes bool        `json:"lengthInBytes,omitempty"`
	ASCIIOnly     bool        `json:"asciiOnly,omitempty"`
	Precision     int         `json:"precision,omitempty"`
	Scale         int         `json:"scale,omitempty"`
	Min           string      `json:"min,omitempty"`
	Max           string      `json:"max,omitempty"`
	EnumValues    []string    `json:"enumValues,omitempty"`
	ForeignKey    *ForeignKey `json:"foreignKey,omitempty"`
	// NextValue 是整数主键/唯一列的下一个可用值（MAX+1），由绑定层查询后通过 SetNextValue 填入。
	NextValue string `json:"nextValue,omitempty"`

	family Family
	base   string
}

// Insertable 表示该列能被写入；计算列与不支持的类型（如 SQL Server rowversion）只能跳过。
func (p Profile) Insertable() bool {
	return !p.Computed
}

// Required 表示该列必须由生成器给值：非空、没有默认值、也不是自增。
func (p Profile) Required() bool {
	return !p.Nullable && !p.HasDefault && !p.AutoIncrement && !p.Computed
}

// ClassifyTable 为表的每一列生成画像，顺序与 columns 一致。
func ClassifyTable(family Family, columns []connection.ColumnDefinition, keys TableKeys) []Profile {
	profiles := make([]Profile, 0, len(columns))
	primaryKey := append([]string(nil), keys.PrimaryKey...)
	for _, column := range columns {
		profile := classifyColumn(family, column)
		if fk, ok := keys.ForeignKeys[strings.ToLower(column.Name)]; ok {
			ref := fk
			profile.ForeignKey = &ref
		}
		if len(keys.PrimaryKey) == 0 && strings.EqualFold(strings.TrimSpace(column.Key), "PRI") {
			primaryKey = append(primaryKey, column.Name)
		}
		if strings.EqualFold(strings.TrimSpace(column.Key), "UNI") {
			profile.Unique = true
		}
		profiles = append(profiles, profile)
	}
	markKey(profiles, primaryKey, true)
	for _, unique := range keys.Unique {
		markKey(profiles, unique, false)
	}
	return profiles
}

func classifyColumn(family Family, column connection.ColumnDefinition) Profile {
	parsed := parseColumnType(column.Type)
	profile := Profile{
		Name:       column.Name,
		Type:       column.Type,
		Comment:    column.Comment,
		Category:   resolveCategory(family, parsed),
		Nullable:   isNullable(column.Nullable),
		HasDefault: column.HasDefault || column.Default != nil,
		family:     family,
		base:       parsed.Base,
	}
	extra := strings.ToLower(column.Extra)
	defaultText := ""
	if column.Default != nil {
		defaultText = strings.ToLower(*column.Default)
	}
	profile.AutoIncrement = isAutoIncrement(extra, defaultText, parsed.Base)
	profile.Computed = isComputed(extra) || (family == FamilySQLServer && (parsed.Base == "timestamp" || parsed.Base == "rowversion"))
	fillShape(&profile, family, parsed, column.Charset)
	return profile
}

func fillShape(profile *Profile, family Family, parsed columnType, charset string) {
	switch profile.Category {
	case CategoryInteger:
		minValue, maxValue := integerBounds(family, parsed)
		profile.Min, profile.Max = formatInt(minValue), formatInt(maxValue)
		if precision, ok := integerDecimalPrecision(parsed); ok {
			profile.Precision = precision
		}
	case CategoryDecimal:
		profile.Precision, profile.Scale = decimalShape(family, parsed)
		if profile.Precision > 0 {
			profile.Max = decimalBoundText(profile.Precision, profile.Scale)
			profile.Min = "-" + profile.Max
			if parsed.Unsigned {
				profile.Min = "0"
			}
		}
	case CategoryString, CategoryText:
		profile.MaxLength, profile.LengthInBytes = stringLimits(family, parsed, profile.Category)
		profile.ASCIIOnly = asciiOnly(family, parsed, charset)
	case CategoryDate, CategoryTime, CategoryDateTime, CategoryYear:
		profile.Min, profile.Max = temporalBounds(family, profile.Category, parsed.Base)
	case CategoryEnum, CategorySet:
		profile.EnumValues = parsed.enumLabels()
	case CategoryBit:
		profile.MaxLength = 1
		if width, ok := parsed.intArg(0); ok && width > 0 {
			profile.MaxLength = width
		}
	}
}

// markKey 标记主键/唯一约束。组合键无法逐列保证唯一，挑一列"锚点"保证唯一即可让整组唯一；
// 组合键里已有自增列时整组天然唯一，不再挑锚点。
func markKey(profiles []Profile, columns []string, primary bool) {
	indexes := make([]int, 0, len(columns))
	for _, name := range columns {
		if index := profileIndex(profiles, name); index >= 0 {
			indexes = append(indexes, index)
		}
	}
	if len(indexes) == 0 {
		return
	}
	for _, index := range indexes {
		if primary {
			profiles[index].PrimaryKey = true
		}
	}
	if len(indexes) == 1 {
		profiles[indexes[0]].Unique = true
		return
	}
	for _, index := range indexes {
		if profiles[index].AutoIncrement || profiles[index].Unique {
			return
		}
	}
	for _, index := range indexes {
		if profiles[index].ForeignKey == nil && canAnchorUnique(profiles[index].Category) {
			profiles[index].Unique = true
			return
		}
	}
}

func canAnchorUnique(category Category) bool {
	switch category {
	case CategoryInteger, CategoryDecimal, CategoryString, CategoryText, CategoryUUID, CategoryDateTime:
		return true
	}
	return false
}

func profileIndex(profiles []Profile, name string) int {
	for i := range profiles {
		if profiles[i].Name == name {
			return i
		}
	}
	for i := range profiles {
		if strings.EqualFold(profiles[i].Name, name) {
			return i
		}
	}
	return -1
}

func isNullable(raw string) bool {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "NO", "N", "FALSE", "0", "NOT NULL":
		return false
	}
	return true
}

func isAutoIncrement(extra, defaultText, base string) bool {
	switch {
	case strings.Contains(extra, "auto_increment"), strings.Contains(extra, "autoincrement"),
		strings.Contains(extra, "identity"):
		return true
	case strings.HasPrefix(strings.TrimSpace(defaultText), "nextval("):
		return true
	}
	switch base {
	case "serial", "serial2", "serial4", "serial8", "smallserial", "bigserial":
		return true
	}
	return false
}

// isComputed 识别不能写入的计算列。注意 MySQL 的 DEFAULT_GENERATED 只是默认值表达式，不算。
func isComputed(extra string) bool {
	for _, marker := range []string{"virtual generated", "stored generated", "generated always", "materialized", "alias", "computed"} {
		if strings.Contains(extra, marker) {
			return true
		}
	}
	return false
}

// SetNextValue 填入整数主键/唯一列的下一个可用值。
func (p *Profile) SetNextValue(value string) {
	p.NextValue = strings.TrimSpace(value)
}

// ApplyEnumValues 用库里查到的枚举标签（如 PG 自定义 enum）补全类别。
func (p *Profile) ApplyEnumValues(labels []string) {
	if len(labels) == 0 {
		return
	}
	p.Category = CategoryEnum
	p.EnumValues = append([]string(nil), labels...)
}
