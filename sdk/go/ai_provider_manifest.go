package plugin

// AIProvider declares a host-managed text/tool provider and its static model catalog.
// It requires ai.providers permission, a backend and an exact declared command.
// Capability flags are always serialized; SupportsImages must be false in version one.
type AIProvider struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Command        string    `json:"command"`
	Models         []AIModel `json:"models"`
	SupportsTools  bool      `json:"supportsTools"`
	SupportsImages bool      `json:"supportsImages"`
}

// AIModel declares an exact case-sensitive model ID and bounded context/output token limits.
type AIModel struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	ContextWindow   int    `json:"contextWindow"`
	MaxOutputTokens int    `json:"maxOutputTokens"`
}
