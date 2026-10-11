package mockdata

import (
	"strings"
	"time"
)

// SuggestPlans 按列画像和列名给出默认生成规则：自增与计算列跳过，外键引用父表，其余按类别与列名推断。
// now 决定日期类默认区间（近一年），由调用方传入以便测试与预览一致。
func SuggestPlans(profiles []Profile, locale string, now time.Time) []ColumnPlan {
	plans := make([]ColumnPlan, 0, len(profiles))
	for _, profile := range profiles {
		plans = append(plans, suggestPlan(profile, resolveLocale(locale), now))
	}
	return plans
}

func suggestPlan(profile Profile, locale string, now time.Time) ColumnPlan {
	plan := ColumnPlan{Name: profile.Name}
	switch {
	case profile.Computed:
		plan.Skip = true
		plan.Generator = Generator{Kind: KindNull}
		return plan
	case profile.AutoIncrement:
		plan.Skip = true
		plan.Generator = Generator{Kind: KindSequence, Start: defaultText(profile.NextValue, "1"), Step: "1"}
		return plan
	case profile.ForeignKey != nil:
		plan.Generator = Generator{Kind: KindReference}
		return plan
	}
	if profile.Category == CategoryBinary || profile.Category == CategoryUnsupported {
		plan.Skip = !profile.Required()
		plan.Generator = Generator{Kind: KindNull}
		if profile.Required() {
			plan.Generator = Generator{Kind: KindFixed}
		}
		return plan
	}
	plan.Generator = suggestGenerator(profile, locale, now)
	return plan
}

func suggestGenerator(profile Profile, locale string, now time.Time) Generator {
	tokens := nameTokens(profile.Name)
	switch profile.Category {
	case CategoryInteger, CategoryYear:
		return suggestInteger(profile, tokens)
	case CategoryDecimal, CategoryFloat:
		return suggestDecimal(profile, tokens)
	case CategoryString, CategoryText:
		return suggestString(profile, tokens, locale, now)
	case CategoryBoolean:
		return Generator{Kind: KindBoolean, Ratio: 0.5}
	case CategoryBit:
		if profile.MaxLength <= 1 {
			return Generator{Kind: KindBoolean, Ratio: 0.5}
		}
		return Generator{Kind: KindBits}
	case CategoryDate:
		if tokens.any("birthday", "birth", "dob", "birthdate") {
			return clampTemporal(profile, Generator{Kind: KindDateRange, Min: "1960-01-01", Max: "2005-12-31"})
		}
		return clampTemporal(profile, Generator{Kind: KindDateRange, Min: now.AddDate(-1, 0, 0).Format(layoutDate), Max: now.Format(layoutDate)})
	case CategoryTime:
		return Generator{Kind: KindTimeRange, Min: "08:00:00", Max: "20:00:00"}
	case CategoryDateTime:
		if profile.Unique {
			return clampTemporal(profile, Generator{Kind: KindDateTimeSequence, Start: now.AddDate(0, 0, -30).Format(layoutDateTime), Step: "1"})
		}
		return clampTemporal(profile, Generator{Kind: KindDateTimeRange, Min: now.AddDate(-1, 0, 0).Format(layoutDateTime), Max: now.Format(layoutDateTime)})
	case CategoryUUID:
		return Generator{Kind: KindUUID}
	case CategoryJSON:
		return Generator{Kind: KindJSON, Locale: locale}
	case CategoryEnum, CategorySet:
		return Generator{Kind: KindEnum}
	case CategoryInet:
		return Generator{Kind: KindIPv4}
	}
	return Generator{Kind: KindNull}
}

func suggestInteger(profile Profile, tokens nameTokenSet) Generator {
	if profile.PrimaryKey || profile.Unique {
		return Generator{Kind: KindSequence, Start: defaultText(profile.NextValue, "1"), Step: "1"}
	}
	switch {
	case profile.Category == CategoryYear || tokens.any("year"):
		return clampInteger(profile, 1990, 2030)
	case tokens.any("age"):
		return clampInteger(profile, 18, 65)
	case tokens.any("gender", "sex", "deleted", "enabled", "disabled", "flag", "is"):
		return clampInteger(profile, 0, 1)
	case tokens.any("status", "state", "type", "level", "kind", "grade", "rank", "priority", "category"):
		return clampInteger(profile, 0, 5)
	case tokens.any("score", "percent", "rate"):
		return clampInteger(profile, 0, 100)
	case tokens.any("count", "qty", "quantity", "num", "stock", "views", "likes", "total", "times"):
		return clampInteger(profile, 0, 1000)
	case tokens.any("price", "amount", "money", "fee", "cost", "salary", "balance"):
		return clampInteger(profile, 1, 10000)
	}
	return clampInteger(profile, 1, 10000)
}

// clampInteger 把默认区间收进列类型范围，例如 tinyint 只到 127。
func clampInteger(profile Profile, low, high int64) Generator {
	if typeLow, ok := parseInt(profile.Min); ok {
		low = max(low, typeLow)
	}
	if typeHigh, ok := parseInt(profile.Max); ok {
		high = min(high, typeHigh)
	}
	if low > high {
		low = high
	}
	return Generator{Kind: KindIntRange, Min: formatInt(low), Max: formatInt(high)}
}

func suggestDecimal(profile Profile, tokens nameTokenSet) Generator {
	scale := profile.Scale
	if profile.Category == CategoryFloat || (profile.Precision == 0 && scale == 0) {
		scale = 2
	}
	if profile.Category == CategoryDecimal && (profile.PrimaryKey || profile.Unique) && profile.Scale == 0 {
		return Generator{Kind: KindSequence, Start: defaultText(profile.NextValue, "1"), Step: "1"}
	}
	low, high := "0", "1000"
	switch {
	case tokens.any("lat", "latitude"):
		low, high, scale = "-90", "90", min(max(scale, 4), 6)
	case tokens.any("lng", "lon", "longitude"):
		low, high, scale = "-180", "180", min(max(scale, 4), 6)
	case tokens.any("rate", "ratio", "discount"):
		low, high = "0", "1"
	case tokens.any("percent", "score"):
		low, high = "0", "100"
	case tokens.any("price", "amount", "money", "fee", "cost", "salary", "balance", "total"):
		low, high = "1", "10000"
	}
	if profile.Category == CategoryDecimal && profile.Precision > 0 {
		scale = profile.Scale
		if typeHigh, ok := truncateDecimalUnits(profile.Max, scale); ok {
			if wantHigh, ok := parseDecimalUnits(high, scale); ok && wantHigh > typeHigh {
				high = formatDecimalUnits(typeHigh, scale)
			}
		}
		if typeLow, ok := truncateDecimalUnits(profile.Min, scale); ok {
			if wantLow, ok := parseDecimalUnits(low, scale); ok && wantLow < typeLow {
				low = formatDecimalUnits(typeLow, scale)
			}
		}
	}
	return Generator{Kind: KindDecimalRange, Min: low, Max: high, Scale: scale}
}

// clampTemporal 把默认日期区间收进列类型范围，例如 MySQL TIMESTAMP 不早于 1970 年。
func clampTemporal(profile Profile, gen Generator) Generator {
	category := temporalCategoryOf(gen.Kind)
	if gen.Kind == KindDateTimeSequence || profile.Min == "" || profile.Max == "" || profile.Category != category {
		return gen
	}
	if gen.Min < profile.Min {
		gen.Min = profile.Min
	}
	if gen.Max > profile.Max {
		gen.Max = profile.Max
	}
	return gen
}

func suggestString(profile Profile, tokens nameTokenSet, locale string, now time.Time) Generator {
	zh := locale == LocaleZH && !profile.ASCIIOnly
	textLocale := LocaleEN
	if zh {
		textLocale = LocaleZH
	}
	// 中文在按字节计的列里占三个字节；英文规则按单字节算，否则 VARCHAR2(10) 只剩 3 个字母。
	capacity := lengthCapacity(profile, zh)
	asciiCapacity := lengthCapacity(profile, false)
	if gen, ok := suggestSemanticString(profile, tokens, textLocale, now); ok {
		return gen
	}
	if profile.Unique {
		return Generator{Kind: KindRandomString, Charset: CharsetAlnum, MinLength: fitCapacity(12, asciiCapacity), MaxLength: fitCapacity(16, asciiCapacity)}
	}
	if asciiCapacity > 0 && asciiCapacity <= 4 {
		return Generator{Kind: KindRandomString, Charset: CharsetUpper, MinLength: 1, MaxLength: asciiCapacity}
	}
	maxLength := 16
	if profile.Category == CategoryText {
		maxLength = 120
	}
	return Generator{Kind: KindText, Locale: textLocale, MinLength: fitCapacity(4, capacity), MaxLength: fitCapacity(maxLength, capacity)}
}

func fitCapacity(length, capacity int) int {
	if capacity > 0 {
		return max(min(length, capacity), 1)
	}
	return length
}

// suggestSemanticString 按列名猜语义。返回 false 时走通用文本规则。
func suggestSemanticString(profile Profile, tokens nameTokenSet, locale string, now time.Time) (Generator, bool) {
	capacity := lengthCapacity(profile, locale == LocaleZH)
	asciiCapacity := lengthCapacity(profile, false)
	switch {
	case tokens.any("email", "mail"):
		return Generator{Kind: KindEmail}, true
	case tokens.any("phone", "mobile", "tel", "telephone", "cellphone"):
		return Generator{Kind: KindPhone, Locale: locale}, true
	case tokens.any("username", "login", "account") || tokens.all("user", "name"):
		return Generator{Kind: KindUsername}, true
	case tokens.any("uuid", "guid") && (asciiCapacity == 0 || asciiCapacity >= 32):
		return Generator{Kind: KindUUID, Compact: asciiCapacity > 0 && asciiCapacity < 36}, true
	case tokens.any("password", "pwd", "secret", "token", "hash", "salt", "sign", "signature"):
		return Generator{Kind: KindRandomString, Charset: CharsetHex, MinLength: fitCapacity(32, asciiCapacity), MaxLength: fitCapacity(32, asciiCapacity)}, true
	case tokens.any("ip", "ipv4", "ipaddr"):
		return Generator{Kind: KindIPv4}, true
	case tokens.any("url", "link", "website", "homepage", "href", "avatar", "image", "img", "pic", "photo", "icon", "logo"):
		return Generator{Kind: KindURL}, true
	case tokens.any("company", "corp", "enterprise", "org", "organization"):
		return Generator{Kind: KindCompany, Locale: locale}, true
	case tokens.any("province", "state"):
		return Generator{Kind: KindProvince, Locale: locale}, true
	case tokens.any("city"):
		return Generator{Kind: KindCity, Locale: locale}, true
	case tokens.any("address", "addr", "street", "location"):
		return Generator{Kind: KindAddress, Locale: locale}, true
	case tokens.any("gender", "sex"):
		return Generator{Kind: KindList, Values: genderValues(locale, asciiCapacity)}, true
	case tokens.any("title", "subject", "label", "product", "goods", "item", "tag"):
		return Generator{Kind: KindText, Locale: locale, MinLength: fitCapacity(4, capacity), MaxLength: fitCapacity(16, capacity)}, true
	case tokens.any("remark", "desc", "description", "content", "comment", "note", "memo", "summary", "bio",
		"detail", "intro", "message", "msg", "reason", "body"):
		return Generator{Kind: KindText, Locale: locale, MinLength: fitCapacity(10, capacity), MaxLength: fitCapacity(80, capacity)}, true
	case tokens.any("code", "no", "sn", "serial", "number"):
		return Generator{Kind: KindRandomString, Charset: CharsetUpperDigits, MinLength: fitCapacity(10, asciiCapacity), MaxLength: fitCapacity(10, asciiCapacity)}, true
	case tokens.any("time", "date", "at", "created", "updated") && (asciiCapacity == 0 || asciiCapacity >= len(layoutDateTime)):
		return Generator{Kind: KindDateTimeRange, Min: now.AddDate(-1, 0, 0).Format(layoutDateTime), Max: now.Format(layoutDateTime)}, true
	case tokens.any("name") && tokens.any(objectNameWords...):
		return Generator{Kind: KindText, Locale: locale, MinLength: fitCapacity(4, capacity), MaxLength: fitCapacity(16, capacity)}, true
	case tokens.any("name", "nickname", "realname", "fullname"):
		return Generator{Kind: KindPersonName, Locale: locale}, true
	}
	return Generator{}, false
}

// objectNameWords 出现时 "xxx_name" 指的是对象名而不是人名，如 file_name、table_name。
var objectNameWords = []string{
	"file", "table", "class", "host", "domain", "db", "database", "app", "project", "task", "job", "role",
	"dept", "department", "category", "menu", "module", "field", "column", "key", "bucket", "queue", "topic",
	"service", "server", "group", "team", "brand", "shop", "store", "course", "book", "product", "goods", "item",
}

func genderValues(locale string, capacity int) []string {
	switch {
	case locale == LocaleZH:
		return []string{"男", "女"}
	case capacity > 0 && capacity < 6:
		return []string{"M", "F"}
	}
	return []string{"male", "female"}
}

// nameTokenSet 是列名按下划线、连字符与驼峰拆出的小写词。
type nameTokenSet map[string]struct{}

func nameTokens(name string) nameTokenSet {
	tokens := nameTokenSet{}
	var current strings.Builder
	flush := func() {
		if current.Len() == 0 {
			return
		}
		word := strings.ToLower(current.String())
		current.Reset()
		tokens[word] = struct{}{}
		// 不带分隔符的 ename、filename、nickname：拆出 name 和前缀，前缀太短（如 e）不单独成词。
		if prefix, ok := strings.CutSuffix(word, "name"); ok && prefix != "" {
			tokens["name"] = struct{}{}
			if len(prefix) >= 2 {
				tokens[prefix] = struct{}{}
			}
		}
	}
	runes := []rune(name)
	for i, r := range runes {
		switch {
		case r == '_' || r == '-' || r == ' ' || r == '.':
			flush()
		case r >= 'A' && r <= 'Z' && i > 0 && runes[i-1] >= 'a' && runes[i-1] <= 'z':
			flush()
			current.WriteRune(r)
		default:
			current.WriteRune(r)
		}
	}
	flush()
	return tokens
}

func (t nameTokenSet) any(words ...string) bool {
	for _, word := range words {
		if _, ok := t[word]; ok {
			return true
		}
	}
	return false
}

func (t nameTokenSet) all(words ...string) bool {
	for _, word := range words {
		if _, ok := t[word]; !ok {
			return false
		}
	}
	return true
}
