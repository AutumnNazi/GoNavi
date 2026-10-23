package sync

import "fmt"

// Keep known units and fixed/variable types in a suggestion; never execute it.
func suggestedCharacterColumnAlter(targetType, targetTable string, finding valueLengthFinding) string {
	base, unit := "varchar", ""
	if parsed, ok := parseMigrationCharacterType(finding.Type); ok {
		base = parsed.base
		if parsed.national {
			base = parsed.typeName
		}
		if parsed.unit != "" {
			unit = " " + parsed.unit
		}
	}
	return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s TYPE %s(%d%s);",
		quoteQualifiedIdentByType(targetType, targetTable), quoteIdentByType(targetType, finding.Column),
		base, suggestedCharColumnLength(finding), unit)
}
