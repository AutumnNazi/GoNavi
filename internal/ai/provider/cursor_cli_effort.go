package provider

import "strings"

// Cursor CLI has no --effort flag. Account catalogs publish each level as a
// distinct model id, with an optional -fast suffix after the effort token.
var cursorCLIEffortTokenOrder = []string{"none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"}
var cursorCLIEffortTokensByLength = []string{"minimal", "medium", "xhigh", "ultra", "high", "none", "max", "low"}

type cursorCLIModelParts struct {
	Family string
	Effort string
	Fast   bool
}

func isCursorCLIEffortToken(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	for _, token := range cursorCLIEffortTokenOrder {
		if normalized == token {
			return true
		}
	}
	return false
}

func parseCursorCLIModelID(model string) cursorCLIModelParts {
	rest := strings.TrimSpace(model)
	if rest == "" {
		return cursorCLIModelParts{}
	}
	fast := strings.HasSuffix(strings.ToLower(rest), "-fast")
	if fast {
		rest = rest[:len(rest)-len("-fast")]
	}
	lower := strings.ToLower(rest)
	for _, token := range cursorCLIEffortTokensByLength {
		suffix := "-" + token
		if strings.HasSuffix(lower, suffix) {
			family := rest[:len(rest)-len(suffix)]
			if strings.TrimSpace(family) == "" {
				break
			}
			return cursorCLIModelParts{Family: family, Effort: token, Fast: fast}
		}
	}
	return cursorCLIModelParts{Family: rest, Fast: fast}
}

func applyCursorCLIModelEffort(model, effort string) string {
	model = strings.TrimSpace(model)
	effort = strings.ToLower(strings.TrimSpace(effort))
	if model == "" || !isCursorCLIEffortToken(effort) {
		return model
	}
	parts := parseCursorCLIModelID(model)
	if strings.TrimSpace(parts.Family) == "" {
		return model
	}
	next := parts.Family + "-" + effort
	if parts.Fast {
		next += "-fast"
	}
	return next
}

func cursorCLIModelCapabilities(models []string) map[string]CLIModelCapability {
	type group struct {
		seen map[string]struct{}
	}
	groups := make(map[string]*group)
	parsed := make([]cursorCLIModelParts, len(models))
	for i, model := range models {
		parts := parseCursorCLIModelID(model)
		parsed[i] = parts
		key := parts.Family + "\x00" + fastGroupKey(parts.Fast)
		g := groups[key]
		if g == nil {
			g = &group{seen: map[string]struct{}{}}
			groups[key] = g
		}
		if parts.Effort != "" {
			g.seen[parts.Effort] = struct{}{}
		}
	}
	result := map[string]CLIModelCapability{}
	for i, model := range models {
		parts := parsed[i]
		g := groups[parts.Family+"\x00"+fastGroupKey(parts.Fast)]
		if g == nil || len(g.seen) < 2 {
			continue
		}
		result[model] = CLIModelCapability{
			EffortValues:  sortCursorCLIEffortValues(g.seen),
			DefaultEffort: parts.Effort,
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func fastGroupKey(fast bool) string {
	if fast {
		return "fast"
	}
	return "default"
}

func sortCursorCLIEffortValues(seen map[string]struct{}) []string {
	values := make([]string, 0, len(seen))
	for _, token := range cursorCLIEffortTokenOrder {
		if _, ok := seen[token]; ok {
			values = append(values, token)
		}
	}
	return values
}
