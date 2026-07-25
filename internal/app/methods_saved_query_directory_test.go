package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	stdRuntime "runtime"
	"testing"
	"time"

	"GoNavi-Wails/internal/appdata"
	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/secretstore"
)

func TestDataRootInfoPayloadIncludesSavedQueryDirectory(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)

	activeRoot := filepath.Join(t.TempDir(), "gonavi-data")
	defaultDirectory := appdata.DefaultSavedQueryDirectory(activeRoot)
	payload := dataRootInfoPayload(activeRoot)
	if payload["savedQueryDirectory"] != defaultDirectory {
		t.Fatalf("savedQueryDirectory = %#v, want %q", payload["savedQueryDirectory"], defaultDirectory)
	}
	if payload["defaultSavedQueryDirectory"] != defaultDirectory {
		t.Fatalf("defaultSavedQueryDirectory = %#v, want %q", payload["defaultSavedQueryDirectory"], defaultDirectory)
	}
	if payload["savedQueryDirectorySource"] != "default" {
		t.Fatalf("savedQueryDirectorySource = %#v, want default", payload["savedQueryDirectorySource"])
	}

	customDirectory := filepath.Join(t.TempDir(), "saved-queries")
	if _, err := appdata.SetConfiguredSavedQueryDirectory(customDirectory); err != nil {
		t.Fatalf("SetConfiguredSavedQueryDirectory returned error: %v", err)
	}
	payload = dataRootInfoPayload(activeRoot)
	if payload["savedQueryDirectory"] != customDirectory {
		t.Fatalf("custom savedQueryDirectory = %#v, want %q", payload["savedQueryDirectory"], customDirectory)
	}
	if payload["savedQueryDirectorySource"] != "custom" {
		t.Fatalf("custom savedQueryDirectorySource = %#v, want custom", payload["savedQueryDirectorySource"])
	}
}

func TestApplySavedQueryDirectoryMigratesBeforeSwitchingConfiguration(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)

	application := NewAppWithSecretStore(secretstore.NewUnavailableStore("test"))
	application.configDir = filepath.Join(t.TempDir(), "gonavi-data")
	query := connection.SavedQuery{
		ID:           "saved-directory-migration",
		Name:         "Directory migration",
		SQL:          "select 42;",
		ConnectionID: "conn-1",
		DBName:       "app",
		CreatedAt:    100,
	}
	if _, err := application.SaveQuery(query); err != nil {
		t.Fatalf("SaveQuery returned error: %v", err)
	}

	targetDirectory := filepath.Join(t.TempDir(), "custom-saved-queries")
	result := application.ApplySavedQueryDirectory(targetDirectory)
	if !result.Success {
		t.Fatalf("ApplySavedQueryDirectory returned failure: %s", result.Message)
	}
	configuredDirectory, err := appdata.ResolveConfiguredSavedQueryDirectory()
	if err != nil {
		t.Fatalf("ResolveConfiguredSavedQueryDirectory returned error: %v", err)
	}
	if configuredDirectory != targetDirectory {
		t.Fatalf("configured saved query directory = %q, want %q", configuredDirectory, targetDirectory)
	}
	payload, ok := result.Data.(map[string]interface{})
	if !ok {
		t.Fatalf("ApplySavedQueryDirectory data = %#v, want data-root payload", result.Data)
	}
	for _, key := range []string{
		"path", "defaultPath", "driverPath", "isDefaultPath", "bootstrapPath",
		"logDirectory", "activeLogDirectory", "logFilePath", "defaultLogDirectory",
		"logDirectorySource", "logDirectoryEditable", "logDirectoryRestartRequired",
		"savedQueryDirectory", "defaultSavedQueryDirectory", "savedQueryDirectorySource",
	} {
		if _, exists := payload[key]; !exists {
			t.Fatalf("ApplySavedQueryDirectory payload missing key %q: %#v", key, payload)
		}
	}
	if payload["savedQueryDirectory"] != targetDirectory || payload["savedQueryDirectorySource"] != "custom" {
		t.Fatalf("ApplySavedQueryDirectory payload has unexpected saved query directory: %#v", payload)
	}

	queries, err := application.GetSavedQueries()
	if err != nil {
		t.Fatalf("GetSavedQueries after directory migration returned error: %v", err)
	}
	if len(queries) != 1 || queries[0].ID != query.ID || queries[0].SQL != query.SQL {
		t.Fatalf("migrated saved queries = %#v, want query %#v", queries, query)
	}
}

func TestApplySavedQueryDirectoryRestoresDefaultDirectory(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)

	application := NewAppWithSecretStore(secretstore.NewUnavailableStore("test"))
	application.configDir = filepath.Join(t.TempDir(), "gonavi-data")
	customDirectory := filepath.Join(t.TempDir(), "custom-saved-queries")
	if _, err := appdata.SetConfiguredSavedQueryDirectory(customDirectory); err != nil {
		t.Fatalf("SetConfiguredSavedQueryDirectory returned error: %v", err)
	}
	query := connection.SavedQuery{
		ID:           "saved-directory-restore",
		Name:         "Directory restore",
		SQL:          "select 84;",
		ConnectionID: "conn-1",
		DBName:       "app",
		CreatedAt:    100,
	}
	if _, err := application.SaveQuery(query); err != nil {
		t.Fatalf("SaveQuery returned error: %v", err)
	}

	defaultDirectory := appdata.DefaultSavedQueryDirectory(application.configDir)
	result := application.ApplySavedQueryDirectory(defaultDirectory)
	if !result.Success {
		t.Fatalf("ApplySavedQueryDirectory default returned failure: %s", result.Message)
	}
	configuredDirectory, err := appdata.ResolveConfiguredSavedQueryDirectory()
	if err != nil {
		t.Fatalf("ResolveConfiguredSavedQueryDirectory returned error: %v", err)
	}
	if configuredDirectory != "" {
		t.Fatalf("configured saved query directory = %q, want default override cleared", configuredDirectory)
	}
	queries, err := application.GetSavedQueries()
	if err != nil {
		t.Fatalf("GetSavedQueries after restoring default returned error: %v", err)
	}
	if len(queries) != 1 || queries[0].ID != query.ID || queries[0].SQL != query.SQL {
		t.Fatalf("restored saved queries = %#v, want query %#v", queries, query)
	}
}

func TestApplySavedQueryDirectoryDoesNotSwitchConfigurationWhenMigrationFails(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)

	application := NewAppWithSecretStore(secretstore.NewUnavailableStore("test"))
	application.configDir = filepath.Join(t.TempDir(), "gonavi-data")
	if _, err := application.SaveQuery(connection.SavedQuery{
		ID:           "saved-directory-failed-migration",
		Name:         "Failed directory migration",
		SQL:          "select 126;",
		ConnectionID: "conn-1",
		DBName:       "app",
		CreatedAt:    100,
	}); err != nil {
		t.Fatalf("SaveQuery returned error: %v", err)
	}

	blockingPath := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blockingPath, []byte("blocked"), 0o644); err != nil {
		t.Fatalf("write blocking path: %v", err)
	}
	result := application.ApplySavedQueryDirectory(blockingPath)
	if result.Success {
		t.Fatalf("ApplySavedQueryDirectory should fail when target is a file: %+v", result)
	}
	configuredDirectory, err := appdata.ResolveConfiguredSavedQueryDirectory()
	if err != nil {
		t.Fatalf("ResolveConfiguredSavedQueryDirectory returned error: %v", err)
	}
	if configuredDirectory != "" {
		t.Fatalf("failed migration changed configured directory to %q", configuredDirectory)
	}
}

func TestApplySavedQueryDirectoryRejectsWebRuntime(t *testing.T) {
	application := NewApp()
	application.webRuntime = true
	result := application.ApplySavedQueryDirectory(filepath.Join(t.TempDir(), "saved-queries"))
	if result.Success {
		t.Fatalf("ApplySavedQueryDirectory should reject web runtime: %+v", result)
	}
}

func TestOpenSavedQueryDirectoryRejectsWebRuntime(t *testing.T) {
	application := NewApp()
	application.webRuntime = true
	result := application.OpenSavedQueryDirectory()
	if result.Success {
		t.Fatalf("OpenSavedQueryDirectory should reject web runtime: %+v", result)
	}
}

func TestSelectSavedQueryDirectoryRejectsWebRuntime(t *testing.T) {
	application := NewApp()
	application.webRuntime = true
	result := application.SelectSavedQueryDirectory("")
	if result.Success {
		t.Fatalf("SelectSavedQueryDirectory should reject web runtime: %+v", result)
	}
}

func TestRevealSavedQueryInFolderRejectsWebRuntime(t *testing.T) {
	application := NewApp()
	application.webRuntime = true
	result := application.RevealSavedQueryInFolder("saved-query")
	if result.Success {
		t.Fatalf("RevealSavedQueryInFolder should reject web runtime: %+v", result)
	}
}

func TestRevealSavedQueryInFolderValidatesQueryID(t *testing.T) {
	application := NewApp()
	result := application.RevealSavedQueryInFolder("  ")
	if result.Success {
		t.Fatalf("RevealSavedQueryInFolder should reject an empty query id: %+v", result)
	}
}

func TestRevealSavedQueryInFolderRejectsMissingQuery(t *testing.T) {
	application := newSavedQueryTestApp(t)
	result := application.RevealSavedQueryInFolder("missing-query")
	if result.Success {
		t.Fatalf("RevealSavedQueryInFolder should reject a missing query: %+v", result)
	}
}

func TestRevealSavedQueryInFolderIgnoresUnrelatedMissingSQLFile(t *testing.T) {
	application := newSavedQueryTestApp(t)
	for _, query := range []connection.SavedQuery{
		{ID: "healthy-query", Name: "Healthy", SQL: "select 1;", ConnectionID: "conn-1", DBName: "app", CreatedAt: 100},
		{ID: "missing-file-query", Name: "Missing", SQL: "select 2;", ConnectionID: "conn-1", DBName: "app", CreatedAt: 101},
	} {
		if _, err := application.SaveQuery(query); err != nil {
			t.Fatalf("SaveQuery(%s) returned error: %v", query.ID, err)
		}
	}
	repository := application.savedQueryRepository()
	healthyPath, found, err := repository.findSQLPath("healthy-query")
	if err != nil || !found {
		t.Fatalf("findSQLPath(healthy-query) = %q, %v, %v", healthyPath, found, err)
	}
	missingPath, found, err := repository.findSQLPath("missing-file-query")
	if err != nil || !found {
		t.Fatalf("findSQLPath(missing-file-query) = %q, %v, %v", missingPath, found, err)
	}
	if err := os.Remove(missingPath); err != nil {
		t.Fatalf("remove unrelated sql file: %v", err)
	}

	previousStart := startSavedQueryRevealCommand
	var startedArgs []string
	startSavedQueryRevealCommand = func(command *exec.Cmd) error {
		startedArgs = append([]string(nil), command.Args...)
		return nil
	}
	t.Cleanup(func() {
		startSavedQueryRevealCommand = previousStart
	})

	result := application.RevealSavedQueryInFolder("healthy-query")
	if !result.Success {
		t.Fatalf("RevealSavedQueryInFolder healthy query returned failure: %+v", result)
	}
	expectedCommand := savedQueryRevealCommand(stdRuntime.GOOS, healthyPath)
	if expectedCommand == nil {
		t.Fatalf("savedQueryRevealCommand does not support test platform %q", stdRuntime.GOOS)
	}
	if !reflect.DeepEqual(startedArgs, expectedCommand.Args) {
		t.Fatalf("reveal command args = %#v, want %#v", startedArgs, expectedCommand.Args)
	}

	startedArgs = nil
	result = application.RevealSavedQueryInFolder("missing-file-query")
	if result.Success {
		t.Fatalf("RevealSavedQueryInFolder should reject the missing target file: %+v", result)
	}
	if len(startedArgs) != 0 {
		t.Fatalf("missing target unexpectedly started file manager: %#v", startedArgs)
	}
}

func TestRevealSavedQueryInFolderSerializesWithDataRootRequests(t *testing.T) {
	application := newSavedQueryTestApp(t)
	if _, err := application.SaveQuery(connection.SavedQuery{
		ID: "serialized-reveal", Name: "Serialized", SQL: "select 1;", ConnectionID: "conn-1", DBName: "app", CreatedAt: 100,
	}); err != nil {
		t.Fatalf("SaveQuery returned error: %v", err)
	}

	previousStart := startSavedQueryRevealCommand
	startSavedQueryRevealCommand = func(*exec.Cmd) error { return nil }
	t.Cleanup(func() {
		startSavedQueryRevealCommand = previousStart
	})

	application.dataRootApplyMu.Lock()
	done := make(chan connection.QueryResult, 1)
	go func() {
		done <- application.RevealSavedQueryInFolder("serialized-reveal")
	}()

	select {
	case <-done:
		application.dataRootApplyMu.Unlock()
		t.Fatal("RevealSavedQueryInFolder bypassed the shared data-root serialization lock")
	case <-time.After(50 * time.Millisecond):
	}
	application.dataRootApplyMu.Unlock()

	select {
	case result := <-done:
		if !result.Success {
			t.Fatalf("serialized RevealSavedQueryInFolder returned failure: %+v", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serialized RevealSavedQueryInFolder did not resume")
	}
}

func TestSavedQueryRevealCommandUsesPlatformFileManager(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "saved query.sql")
	tests := []struct {
		platform string
		want     []string
	}{
		{platform: "darwin", want: []string{"open", "-R", filePath}},
		{platform: "windows", want: []string{"explorer.exe", "/select," + filePath}},
		{platform: "linux", want: []string{"xdg-open", filepath.Dir(filePath)}},
	}
	for _, test := range tests {
		t.Run(test.platform, func(t *testing.T) {
			command := savedQueryRevealCommand(test.platform, filePath)
			if command == nil {
				t.Fatalf("savedQueryRevealCommand(%q) returned nil", test.platform)
			}
			if !reflect.DeepEqual(command.Args, test.want) {
				t.Fatalf("savedQueryRevealCommand(%q) args = %#v, want %#v", test.platform, command.Args, test.want)
			}
		})
	}
	if command := savedQueryRevealCommand("plan9", filePath); command != nil {
		t.Fatalf("unsupported platform command = %#v, want nil", command.Args)
	}
}
