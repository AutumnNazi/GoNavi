package runharness

import (
	"runtime"
	"strings"
	"testing"
)

func TestSQLiteFileURIKeepsWindowsDriveInPath(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("drive-letter file URIs are Windows-specific")
	}
	got, err := SQLiteFileURI(`C:\data\agent_runs.sqlite`, nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.HasPrefix(got, "file://C:") {
		t.Fatalf("URI treats the drive as a host: %s", got)
	}
	if !strings.HasPrefix(got, "file:///C:/data/agent_runs.sqlite") {
		t.Fatalf("URI = %s", got)
	}
}
