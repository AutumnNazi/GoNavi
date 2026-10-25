package market

import "strings"

// compareSemver orders two versions with the shared marketplace semantics:
// an optional v prefix, numeric major.minor.patch cores, and a prerelease
// suffix that sorts below the release it annotates (numeric identifiers
// below alphanumeric, fewer identifiers below more). Empty sides are equal.
func compareSemver(left, right string) int {
	core := func(value string) string {
		value = strings.TrimPrefix(strings.TrimSpace(value), "v")
		if at := strings.Index(value, "+"); at >= 0 {
			value = value[:at]
		}
		return value
	}
	l, r := core(left), core(right)
	if l == "" || r == "" {
		return 0
	}
	lc, rc := numericCore(l), numericCore(r)
	for index := 0; index < 3; index++ {
		a, b := coreAt(lc, index), coreAt(rc, index)
		if a != b {
			if a < b {
				return -1
			}
			return 1
		}
	}
	lpre, rpre := prereleaseSuffix(l), prereleaseSuffix(r)
	if lpre == rpre {
		return 0
	}
	if lpre == "" {
		return 1
	}
	if rpre == "" {
		return -1
	}
	return comparePrerelease(lpre, rpre)
}

// versionNewer reports whether candidate sorts above current.
func versionNewer(candidate, current string) bool {
	return compareSemver(candidate, current) > 0
}

func numericCore(value string) []int {
	parts := strings.Split(strings.SplitN(value, "-", 2)[0], ".")
	numbers := make([]int, len(parts))
	for index, part := range parts {
		number := 0
		valid := part != ""
		for _, digit := range part {
			if digit < '0' || digit > '9' {
				valid = false
				break
			}
			number = number*10 + int(digit-'0')
		}
		if !valid {
			number = 0
		}
		numbers[index] = number
	}
	return numbers
}

func coreAt(values []int, index int) int {
	if index < len(values) {
		return values[index]
	}
	return 0
}

func prereleaseSuffix(core string) string {
	if at := strings.Index(core, "-"); at >= 0 {
		return core[at+1:]
	}
	return ""
}

func comparePrerelease(left, right string) int {
	lp := strings.Split(left, ".")
	rp := strings.Split(right, ".")
	for index := 0; index < len(lp) && index < len(rp); index++ {
		if lp[index] == rp[index] {
			continue
		}
		ln, lnum := numericIdentifier(lp[index])
		rn, rnum := numericIdentifier(rp[index])
		switch {
		case lnum && rnum && ln != rn:
			if ln < rn {
				return -1
			}
			return 1
		case lnum && !rnum:
			return -1
		case !lnum && rnum:
			return 1
		case lp[index] < rp[index]:
			return -1
		default:
			return 1
		}
	}
	switch {
	case len(lp) < len(rp):
		return -1
	case len(lp) > len(rp):
		return 1
	}
	return 0
}

func numericIdentifier(value string) (int, bool) {
	if value == "" {
		return 0, false
	}
	number := 0
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return 0, false
		}
		number = number*10 + int(digit-'0')
	}
	return number, true
}
