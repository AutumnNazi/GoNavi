package app

import (
	"strings"
	"testing"

	"GoNavi-Wails/internal/sessionassets"
)

func TestSessionAssetsDetectRejectsUnsupportedKind(t *testing.T) {
	a := NewApp()
	result := a.SessionAssetsDetect(sessionassets.DetectInput{Kind: "claude-code"})
	if result.Success {
		t.Fatalf("unsupported kind must fail, got success")
	}
	if !strings.Contains(result.Message, "claude-code") {
		t.Fatalf("message should name the unsupported kind, got %q", result.Message)
	}
}

func TestSessionAssetsEnableRejectsUnsupportedKind(t *testing.T) {
	a := NewApp()
	result := a.SessionAssetsEnable(sessionassets.EnableInput{Kind: "workbuddy"})
	if result.Success {
		t.Fatalf("unsupported kind must fail, got success")
	}
}

func TestSessionAssetsDisableRejectsUnsupportedKind(t *testing.T) {
	a := NewApp()
	result := a.SessionAssetsDisable("not-an-agent")
	if result.Success {
		t.Fatalf("unsupported kind must fail, got success")
	}
}

func TestSourceIdentityKeyNormalizesPaths(t *testing.T) {
	left := sourceIdentityKey(`C:\Users\Dev\.CODEX`)
	right := sourceIdentityKey("c:/users/dev/.codex")
	if left == "" {
		t.Fatalf("identity key must not be empty for a valid path")
	}
	if left != right {
		t.Fatalf("identity key must normalize separators and case: %q vs %q", left, right)
	}
	if sourceIdentityKey("   ") != "" {
		t.Fatalf("blank path must yield empty identity")
	}
}
