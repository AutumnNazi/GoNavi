package sync

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"GoNavi-Wails/internal/connection"
)

// Character qualifiers are parsed before normalization, not erased by string replacement.
var migrationCharacterPattern = regexp.MustCompile(`(?i)^\s*(character\s+varying|national\s+character\s+varying|national\s+char(?:acter)?|varchar2?|nvarchar2?|nchar|character|char|bpchar)\s*\(\s*([0-9]+)\s*(CHAR|BYTE)?\s*\)\s*$`)

type migrationCharacterType struct {
	base     string
	typeName string
	length   int
	unit     string
	national bool
}

func parseMigrationCharacterType(raw string) (migrationCharacterType, bool) {
	match := migrationCharacterPattern.FindStringSubmatch(raw)
	if match == nil {
		return migrationCharacterType{}, false
	}
	length, err := strconv.Atoi(match[2])
	if err != nil || length <= 0 {
		return migrationCharacterType{}, false
	}
	base := strings.ToLower(strings.Join(strings.Fields(match[1]), " "))
	typeName := base
	unit := strings.ToUpper(match[3])
	national := strings.HasPrefix(base, "nchar") || strings.HasPrefix(base, "nvarchar") || strings.HasPrefix(base, "national ")
	switch base {
	case "varchar", "varchar2", "nvarchar", "nvarchar2", "character varying", "national character varying":
		base = "varchar"
	default:
		base = "char"
	}
	return migrationCharacterType{base: base, typeName: typeName, length: length, unit: unit, national: national}, true
}

// gaussLengthUnit keeps NVARCHAR/NVARCHAR2 character-counted even on old versions.
// NCHAR aliases fixed CHAR there, so its unqualified unit stays unknown.
func (t migrationCharacterType) gaussLengthUnit() string {
	if t.unit == "" && t.national && t.base == "varchar" {
		return "CHAR"
	}
	return t.unit
}

func normalizeMigrationCharacterType(raw string) string {
	parsed, ok := parseMigrationCharacterType(raw)
	if !ok {
		return raw
	}
	return fmt.Sprintf("%s(%d)", parsed.base, parsed.length)
}

// AdaptSource uses the original metadata after the shared intermediate mapping.
// BYTE sources retain a conservative encoding budget: equal byte limits across
// different encodings do not necessarily fit the same data.
func (w *byteLengthWidener) AdaptSource(source, intermediate connection.ColumnDefinition) connection.ColumnDefinition {
	if w == nil || !w.active {
		return intermediate
	}
	original, ok := parseMigrationCharacterType(source.Type)
	mapped, mappedOK := parseMigrationCharacterType(intermediate.Type)
	if !ok || !mappedOK {
		return w.Adapt(intermediate)
	}
	if w.qualified && (original.unit == "CHAR" || original.national) {
		intermediate.Type = fmt.Sprintf("%s(%d CHAR)", mapped.base, mapped.length)
		return intermediate
	}
	intermediate = w.Adapt(intermediate)
	if w.qualified && original.unit == "BYTE" {
		if widened, ok := parseMigrationCharacterType(intermediate.Type); ok {
			intermediate.Type = fmt.Sprintf("%s(%d BYTE)", widened.base, widened.length)
		}
	}
	return intermediate
}
