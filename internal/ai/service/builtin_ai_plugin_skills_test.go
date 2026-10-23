package aiservice

import (
	"testing"

	"GoNavi-Wails/internal/ai"
)

func TestBuiltinAIKeepsPackagedSkillToolsOutsideCuratedWhitelist(t *testing.T) {
	const alias = "skill__aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	tools := []ai.Tool{
		{Type: "function", Function: ai.ToolFunction{Name: alias, Description: "Read a package resource", Parameters: map[string]any{"type": "object"}}},
		{Type: "function", Function: ai.ToolFunction{Name: "execute_sql"}},
		{Type: "function", Function: ai.ToolFunction{Name: inspectSourceToolName}},
	}
	for _, family := range []string{"", "mysql", "redis"} {
		for _, tool := range builtinAIToolsFor(tools, family) {
			if tool.Function.Name == alias {
				t.Fatalf("hosted provider advertised packaged skill for %q", family)
			}
		}
	}
	calls := []ai.ToolCall{{ID: "skill-call", Type: "function", Function: ai.ToolCallFunction{Name: alias, Arguments: "{}"}}}
	allowed, _ := guardBuiltinAIToolCalls(calls, "", "", builtinAITarget{})
	if len(allowed) != 0 || builtinAICompletesConnection(alias) {
		t.Fatal("packaged skill alias widened hosted AI tools")
	}
}
