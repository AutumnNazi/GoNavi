package app

// WHILE and REPEAT do not increase BEGIN depth. Their END keywords must not
// decrease it either, but only MySQL/MariaDB use these compound-statement ends.
func isPLSQLControlEnd(text string, tokenEnd int, dbType string) bool {
	switch nextSQLSignificantToken(text, tokenEnd) {
	case "if", "loop", "case":
		return true
	case "while", "repeat":
		switch normalizeExplainLexicalDBType(dbType) {
		case "mysql", "mariadb":
			return true
		}
	}
	return false
}
