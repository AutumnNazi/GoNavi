package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/appdata"
	"GoNavi-Wails/internal/connection"
)

func TestBuildLogDirectoryInfoPayloadMarksPendingRestart(t *testing.T) {
	configured := filepath.Join(t.TempDir(), "configured")
	active := filepath.Join(t.TempDir(), "active", "gonavi.log")
	defaultDirectory := filepath.Join(t.TempDir(), "default")

	payload := buildLogDirectoryInfoPayload(configured, defaultDirectory, active, false)
	if payload["logDirectory"] != configured {
		t.Fatalf("logDirectory = %#v, want %q", payload["logDirectory"], configured)
	}
	if payload["activeLogDirectory"] != filepath.Dir(active) {
		t.Fatalf("activeLogDirectory = %#v, want %q", payload["activeLogDirectory"], filepath.Dir(active))
	}
	if payload["logDirectorySource"] != "custom" {
		t.Fatalf("logDirectorySource = %#v, want custom", payload["logDirectorySource"])
	}
	if payload["logDirectoryEditable"] != true {
		t.Fatalf("logDirectoryEditable = %#v, want true", payload["logDirectoryEditable"])
	}
	if payload["logDirectoryRestartRequired"] != true {
		t.Fatalf("logDirectoryRestartRequired = %#v, want true", payload["logDirectoryRestartRequired"])
	}
}

func TestBuildLogDirectoryInfoPayloadMarksEnvironmentManaged(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "environment")
	payload := buildLogDirectoryInfoPayload(directory, filepath.Join(t.TempDir(), "default"), filepath.Join(directory, "gonavi.log"), true)
	if payload["logDirectorySource"] != "environment" {
		t.Fatalf("logDirectorySource = %#v, want environment", payload["logDirectorySource"])
	}
	if payload["logDirectoryEditable"] != false {
		t.Fatalf("logDirectoryEditable = %#v, want false", payload["logDirectoryEditable"])
	}
	if payload["logDirectoryRestartRequired"] != false {
		t.Fatalf("logDirectoryRestartRequired = %#v, want false", payload["logDirectoryRestartRequired"])
	}
}

func TestApplyLogDirectoryRejectsFilePathWithoutChangingSetting(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("GONAVI_LOG_DIR", "")

	blockingPath := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blockingPath, []byte("blocked"), 0o644); err != nil {
		t.Fatalf("write blocking path: %v", err)
	}
	result := NewApp().ApplyLogDirectory(blockingPath)
	if result.Success {
		t.Fatalf("ApplyLogDirectory should reject a file path: %+v", result)
	}
	configured, err := appdata.ResolveConfiguredLogDirectory()
	if err != nil {
		t.Fatalf("ResolveConfiguredLogDirectory returned error: %v", err)
	}
	if configured != "" {
		t.Fatalf("failed apply changed log directory to %q", configured)
	}
}

func TestApplyLogDirectoryRejectsEnvironmentManagedSetting(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("GONAVI_LOG_DIR", filepath.Join(t.TempDir(), "environment-logs"))

	result := NewApp().ApplyLogDirectory(filepath.Join(t.TempDir(), "custom-logs"))
	if result.Success {
		t.Fatalf("ApplyLogDirectory should reject environment-managed setting: %+v", result)
	}
}

func TestApplyLogDirectoryRejectsWebRuntime(t *testing.T) {
	application := NewApp()
	application.webRuntime = true
	result := application.ApplyLogDirectory(filepath.Join(t.TempDir(), "custom-logs"))
	if result.Success {
		t.Fatalf("ApplyLogDirectory should reject web runtime: %+v", result)
	}
}

func TestApplyLogDirectorySerializesWithDataRootRequests(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("GONAVI_LOG_DIR", "")

	application := NewApp()
	customLogDirectory := filepath.Join(t.TempDir(), "custom-logs")
	application.dataRootApplyMu.Lock()
	done := make(chan connection.QueryResult, 1)
	go func() {
		done <- application.ApplyLogDirectory(customLogDirectory)
	}()

	select {
	case <-done:
		application.dataRootApplyMu.Unlock()
		t.Fatal("ApplyLogDirectory bypassed the shared data-root serialization lock")
	case <-time.After(50 * time.Millisecond):
	}
	application.dataRootApplyMu.Unlock()

	select {
	case result := <-done:
		if !result.Success {
			t.Fatalf("serialized ApplyLogDirectory returned failure: %s", result.Message)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serialized ApplyLogDirectory did not resume")
	}
}
