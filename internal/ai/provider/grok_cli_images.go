package provider

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"GoNavi-Wails/internal/ai"
)

// Grok's --prompt-json accepts ACP content blocks, not OpenAI image_url or
// Anthropic source blocks. Keep image bytes out of the plain text prompt.
type grokCLIContentBlock struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Data     string `json:"data,omitempty"`
	MIMEType string `json:"mimeType,omitempty"`
}

// A .json suffix makes Grok parse --prompt-file as ACP content blocks. A .txt
// file is plain text even if its contents look like JSON. File transport keeps
// large screenshots off argv and preserves the existing tool isolation flags.
func createGrokCLIRequestPromptFile(messages []ai.Message, prompt string) (string, func(), error) {
	if !requestMessagesContainImages(messages) {
		return createGrokCLIPromptFile(prompt)
	}
	blocks, err := buildGrokCLIContentBlocks(messages)
	if err != nil {
		return "", func() {}, err
	}
	payload, err := json.Marshal(blocks)
	if err != nil {
		return "", func() {}, fmt.Errorf("encode Grok CLI image prompt: %w", err)
	}
	return createGrokCLITempPromptFile(string(payload), ".json")
}

func createGrokCLIPromptFile(prompt string) (string, func(), error) {
	return createGrokCLITempPromptFile(prompt, ".txt")
}

func createGrokCLITempPromptFile(prompt, suffix string) (string, func(), error) {
	file, err := os.CreateTemp("", "gonavi-grok-prompt-*"+suffix)
	if err != nil {
		return "", func() {}, fmt.Errorf("create Grok CLI prompt file failed: %w", err)
	}
	path := file.Name()
	cleanup := func() { _ = os.Remove(path) }
	if _, err := file.WriteString(prompt); err != nil {
		_ = file.Close()
		cleanup()
		return "", func() {}, fmt.Errorf("write Grok CLI prompt file failed: %w", err)
	}
	if err := file.Close(); err != nil {
		cleanup()
		return "", func() {}, fmt.Errorf("close Grok CLI prompt file failed: %w", err)
	}
	return path, cleanup, nil
}

func buildGrokCLIContentBlocks(messages []ai.Message) ([]grokCLIContentBlock, error) {
	blocks := make([]grokCLIContentBlock, 0, len(messages)+1)
	if prompt := buildPrompt(messages); prompt != "" {
		blocks = append(blocks, grokCLIContentBlock{Type: "text", Text: prompt})
	}
	for _, message := range messages {
		for _, image := range message.Images {
			mimeType, data, err := ParseDataURI(strings.TrimSpace(image))
			if err != nil {
				return nil, fmt.Errorf("parse Grok CLI image: %w", err)
			}
			if !strings.HasPrefix(mimeType, "image/") || data == "" {
				return nil, fmt.Errorf("invalid Grok CLI image content")
			}
			if _, err := base64.StdEncoding.DecodeString(data); err != nil {
				return nil, fmt.Errorf("decode Grok CLI image: %w", err)
			}
			blocks = append(blocks, grokCLIContentBlock{Type: "image", Data: data, MIMEType: mimeType})
		}
	}
	return blocks, nil
}
