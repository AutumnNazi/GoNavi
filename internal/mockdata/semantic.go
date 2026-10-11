package mockdata

import (
	"strconv"
	"strings"
)

const (
	alphabetLower  = "abcdefghijklmnopqrstuvwxyz"
	alphabetUpper  = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	alphabetDigits = "0123456789"
)

// compileSemantic 编译字符串类与语义类规则；输出在写入前由生产者按列长度截断。
func compileSemantic(in compileInput) (valueFunc, *PlanError) {
	locale := resolveLocale(in.gen.Locale, in.locale)
	zh := locale == LocaleZH
	switch in.gen.Kind {
	case KindRandomString:
		return compileRandomString(in)
	case KindText:
		return compileText(in, zh)
	case KindJSON:
		if limit := in.profile.MaxLength; in.profile.Category != CategoryJSON && limit > 0 && limit < 80 {
			return nil, in.fail(ErrCodeInvalidLength, strconv.Itoa(limit))
		}
		return func(rng randSource, row int) (string, bool) { return randomJSON(rng, row, zh), false }, nil
	case KindUsername:
		return func(rng randSource, _ int) (string, bool) { return randomUsername(rng), false }, nil
	case KindEmail:
		return func(rng randSource, _ int) (string, bool) { return randomEmail(rng), false }, nil
	case KindPhone:
		return func(rng randSource, _ int) (string, bool) { return randomPhone(rng, zh), false }, nil
	case KindURL:
		return func(rng randSource, _ int) (string, bool) { return randomURL(rng), false }, nil
	case KindIPv4:
		return func(rng randSource, _ int) (string, bool) { return randomIPv4(rng), false }, nil
	}
	if zh && in.profile.ASCIIOnly {
		return nil, in.fail(ErrCodeASCIIOnly, string(in.gen.Kind))
	}
	switch in.gen.Kind {
	case KindPersonName:
		return func(rng randSource, _ int) (string, bool) { return randomPersonName(rng, zh), false }, nil
	case KindProvince:
		return func(rng randSource, _ int) (string, bool) { return randomProvince(rng, zh), false }, nil
	case KindCity:
		return func(rng randSource, _ int) (string, bool) { return randomCity(rng, zh), false }, nil
	case KindAddress:
		return func(rng randSource, _ int) (string, bool) { return randomAddress(rng, zh), false }, nil
	case KindCompany:
		return func(rng randSource, _ int) (string, bool) { return randomCompany(rng, zh), false }, nil
	}
	return nil, in.fail(ErrCodeKindNotAllowed, string(in.gen.Kind))
}

func resolveLocale(values ...string) string {
	for _, value := range values {
		switch strings.ToLower(strings.TrimSpace(value)) {
		case LocaleZH, "zh-cn", "zh-tw", "zh_cn", "zh_tw":
			return LocaleZH
		case LocaleEN, "en-us", "en_us":
			return LocaleEN
		}
	}
	return LocaleEN
}

func lengthRange(in compileInput, defaultMin, defaultMax int, wide bool) (int, int, *PlanError) {
	capacity := lengthCapacity(in.profile, wide)
	maxLength := in.gen.MaxLength
	if maxLength <= 0 {
		maxLength = defaultMax
		if capacity > 0 {
			maxLength = min(maxLength, capacity)
		}
	}
	minLength := in.gen.MinLength
	if minLength <= 0 {
		minLength = min(defaultMin, maxLength)
	}
	if minLength <= 0 || minLength > maxLength {
		return 0, 0, in.fail(ErrCodeInvalidRange, "")
	}
	if capacity > 0 && maxLength > capacity {
		return 0, 0, in.fail(ErrCodeInvalidLength, strconv.Itoa(capacity))
	}
	return minLength, maxLength, nil
}

func compileRandomString(in compileInput) (valueFunc, *PlanError) {
	charset := in.gen.Charset
	if charset == "" {
		charset = CharsetAlnum
	}
	chinese := charset == CharsetChinese
	if chinese && in.profile.ASCIIOnly {
		return nil, in.fail(ErrCodeASCIIOnly, charset)
	}
	alphabet := []rune(charsetAlphabet(charset))
	minLength, maxLength, err := lengthRange(in, 8, 16, chinese)
	if err != nil {
		return nil, err
	}
	return func(rng randSource, _ int) (string, bool) {
		length := minLength + rng.IntN(maxLength-minLength+1)
		runes := make([]rune, length)
		for i := range runes {
			runes[i] = pick(rng, alphabet)
		}
		return string(runes), false
	}, nil
}

func charsetAlphabet(charset string) string {
	switch charset {
	case CharsetAlpha:
		return alphabetLower + alphabetUpper
	case CharsetLower:
		return alphabetLower
	case CharsetUpper:
		return alphabetUpper
	case CharsetUpperDigits:
		return alphabetUpper + alphabetDigits
	case CharsetDigits:
		return alphabetDigits
	case CharsetHex:
		return alphabetDigits + "abcdef"
	case CharsetChinese:
		return string(zhCommonChars)
	}
	return alphabetLower + alphabetUpper + alphabetDigits
}

func compileText(in compileInput, zh bool) (valueFunc, *PlanError) {
	if zh && in.profile.ASCIIOnly {
		return nil, in.fail(ErrCodeASCIIOnly, string(in.gen.Kind))
	}
	minLength, maxLength, err := lengthRange(in, 10, 120, zh)
	if err != nil {
		return nil, err
	}
	return func(rng randSource, _ int) (string, bool) {
		target := minLength + rng.IntN(maxLength-minLength+1)
		if zh {
			return randomChineseText(rng, target), false
		}
		return randomEnglishText(rng, target), false
	}, nil
}

func randomChineseText(rng randSource, target int) string {
	var builder strings.Builder
	count := 0
	for count < target {
		word := pick(rng, zhTextWords)
		builder.WriteString(word)
		count += len([]rune(word))
		if count < target && rng.IntN(4) == 0 {
			builder.WriteString(pick(rng, zhPunctuation))
			count++
		}
	}
	runes := []rune(builder.String())[:target]
	if target > 1 {
		runes[target-1] = '。'
	}
	return string(runes)
}

func randomEnglishText(rng randSource, target int) string {
	var builder strings.Builder
	for builder.Len() < target {
		if builder.Len() > 0 {
			builder.WriteByte(' ')
		}
		builder.WriteString(pick(rng, enTextWords))
	}
	text := []byte(builder.String()[:target])
	text[0] = strings.ToUpper(string(text[0]))[0]
	if target > 1 {
		text[target-1] = '.'
	}
	return string(text)
}

func randomPersonName(rng randSource, zh bool) string {
	if !zh {
		return pick(rng, enFirstNames) + " " + pick(rng, enLastNames)
	}
	name := pick(rng, zhSurnames) + pick(rng, zhGivenNameChars)
	if rng.IntN(3) > 0 {
		name += pick(rng, zhGivenNameChars)
	}
	return name
}

func randomUsername(rng randSource) string {
	first := strings.ToLower(pick(rng, enFirstNames))
	switch rng.IntN(3) {
	case 0:
		return first + strconv.Itoa(rng.IntN(1000))
	case 1:
		return first + "_" + strings.ToLower(pick(rng, enLastNames))
	}
	return first + "." + strings.ToLower(pick(rng, enLastNames)) + strconv.Itoa(rng.IntN(100))
}

func randomEmail(rng randSource) string {
	return randomUsername(rng) + "@" + pick(rng, emailDomains)
}

func randomPhone(rng randSource, zh bool) string {
	if zh {
		return pick(rng, cnMobilePrefixes) + strconv.Itoa(10000000+rng.IntN(90000000))
	}
	return "+1-555-" + strconv.Itoa(100+rng.IntN(900)) + "-" + strconv.Itoa(1000+rng.IntN(9000))
}

func randomProvince(rng randSource, zh bool) string {
	if zh {
		return pick(rng, zhProvinces).Name
	}
	return pick(rng, enStates).Name
}

func randomCity(rng randSource, zh bool) string {
	if zh {
		return pick(rng, pick(rng, zhProvinces).Cities)
	}
	return pick(rng, pick(rng, enStates).Cities)
}

func randomAddress(rng randSource, zh bool) string {
	if !zh {
		state := pick(rng, enStates)
		return strconv.Itoa(1+rng.IntN(9999)) + " " + pick(rng, enStreetNames) + " " + pick(rng, enStreetSuffixes) +
			", " + pick(rng, state.Cities) + ", " + state.Name
	}
	province := pick(rng, zhProvinces)
	city := pick(rng, province.Cities)
	prefix := province.Name + city
	if province.Name == city {
		prefix = city
	}
	return prefix + pick(rng, zhDistrictWords) + pick(rng, zhDistrictSuffixes) + pick(rng, zhRoadWords) +
		pick(rng, zhRoadSuffixes) + strconv.Itoa(1+rng.IntN(999)) + "号"
}

func randomCompany(rng randSource, zh bool) string {
	if !zh {
		return pick(rng, enCompanyWords) + " " + pick(rng, enCompanySuffixes)
	}
	city := strings.TrimSuffix(pick(rng, pick(rng, zhProvinces).Cities), "市")
	return city + pick(rng, zhCompanyWords) + pick(rng, zhIndustries) + pick(rng, zhCompanySuffixes)
}

func randomURL(rng randSource) string {
	return "https://" + pick(rng, urlWords) + ".example.com/" + pick(rng, urlWords) + "/" + strconv.Itoa(rng.IntN(100000))
}

func randomIPv4(rng randSource) string {
	first := 1 + rng.IntN(223)
	if first == 127 {
		first = 10
	}
	return strconv.Itoa(first) + "." + strconv.Itoa(rng.IntN(256)) + "." + strconv.Itoa(rng.IntN(256)) + "." +
		strconv.Itoa(1+rng.IntN(254))
}

func randomJSON(rng randSource, row int, zh bool) string {
	name := strconv.Quote(randomPersonName(rng, zh))
	active := "false"
	if rng.IntN(2) == 0 {
		active = "true"
	}
	return `{"id":` + strconv.Itoa(row+1) + `,"name":` + name + `,"score":` + strconv.Itoa(rng.IntN(101)) +
		`,"active":` + active + `}`
}
