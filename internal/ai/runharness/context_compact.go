package runharness

import (
	"encoding/json"
	"fmt"
	"unicode/utf8"
)

// contextCompactPercent is when older transcript text is shortened. The ledger
// stays intact; only the provider projection is reduced, and the newest user
// turn is left whole so a follow-up can still call tools.
const contextCompactPercent = 90

func compactContextTranscript(messages []Message, estimate TokenEstimator, maxTokens int) ([]Message, bool) {
	if maxTokens <= 0 || len(messages) < 2 {
		return messages, false
	}
	_, tokens := contextMessagesSize(messages, estimate)
	if tokens <= maxTokens*contextCompactPercent/100 {
		return messages, false
	}
	protectFrom := len(messages) - 1
	for index := len(messages) - 1; index >= 0; index-- {
		if messages[index].Role == "user" {
			protectFrom = index
			break
		}
	}
	compacted := cloneContextMessages(messages)
	changed := false
	for index := 0; index < protectFrom; index++ {
		next, ok := compactContextMessage(compacted[index])
		if !ok {
			continue
		}
		compacted[index] = next
		changed = true
	}
	if !changed {
		return messages, false
	}
	return compacted, true
}

func compactContextMessage(message Message) (Message, bool) {
	changed := false
	if message.Reasoning != "" {
		message.Reasoning = ""
		changed = true
	}
	switch message.Role {
	case "tool":
		if utf8.RuneCountInString(message.Content) > 200 {
			message.Content = compactToolProjection(message.Content)
			changed = true
		}
	case "assistant":
		if utf8.RuneCountInString(message.Content) > 320 {
			message.Content = clipContextRunes(message.Content, 320)
			changed = true
		}
	case "user":
		if utf8.RuneCountInString(message.Content) > 240 {
			message.Content = clipContextRunes(message.Content, 240)
			changed = true
		}
	}
	return message, changed
}

func compactToolProjection(content string) string {
	var payload map[string]any
	if json.Unmarshal([]byte(content), &payload) == nil {
		if text, ok := payload["error"].(string); ok && text != "" {
			return fmt.Sprintf(`{"error":%q}`, clipContextRunes(text, 160))
		}
	}
	return fmt.Sprintf("[earlier tool result omitted, %d bytes]", len(content))
}

func clipContextRunes(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit]) + "…"
}
