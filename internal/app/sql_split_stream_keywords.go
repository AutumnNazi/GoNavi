package app

import "strings"

func shouldDeferPLSQLKeywordInStream(text string, tokenStart int, tokenEnd int, token string) bool {
	switch token {
	case "begin", "declare", "end", "case", "create", "or", "replace", "editionable", "noneditionable", "procedure", "function", "package", "body", "is", "as":
	default:
		return false
	}
	if tokenEnd >= len(text) {
		return true
	}
	next := skipSQLTrivia(text, tokenEnd)
	if next >= len(text) {
		return true
	}
	// Do not resolve END's suffix before a comment marker is fully available.
	if next == len(text)-1 && (text[next] == '/' || text[next] == '-') {
		return true
	}
	if isSQLIdentifierStart(text[next]) {
		nextEnd := next + 1
		for nextEnd < len(text) && isSQLIdentifierPart(text[nextEnd]) {
			nextEnd++
		}
		if nextEnd >= len(text) {
			return true
		}
		if token == "begin" {
			nextToken := strings.ToLower(text[next:nextEnd])
			if nextToken == "not" || nextToken == "distributed" {
				following := skipSQLTrivia(text, nextEnd)
				if following >= len(text) {
					return true
				}
				if isSQLIdentifierStart(text[following]) {
					followingEnd := following + 1
					for followingEnd < len(text) && isSQLIdentifierPart(text[followingEnd]) {
						followingEnd++
					}
					return followingEnd >= len(text)
				}
			}
		}
	}
	return false
}

func shouldDeferPLSQLKeywordPrefixInStream(text string, tokenStart int, tokenEnd int, token string) bool {
	if tokenEnd < len(text) {
		return false
	}
	for _, keyword := range []string{"begin", "declare", "end", "case", "create", "or", "replace", "editionable", "noneditionable", "procedure", "function", "package", "body", "is", "as"} {
		if strings.HasPrefix(keyword, token) && token != keyword {
			if tokenStart > 0 && isSQLIdentifierPart(text[tokenStart-1]) {
				return false
			}
			return true
		}
	}
	return false
}
