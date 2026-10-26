package plugin

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRunningLifecycleNotificationIsDeliveredOnce(t *testing.T) {
	m := testManager(t)
	status := installFixture(t, m, "example.lifecycle", "echo")
	enableFixture(t, m, status.Manifest.ID)
	if err := m.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	running := waitState(t, m, status.Manifest.ID, StateRunning)
	path := filepath.Join(m.root, "data", status.Manifest.ID, "lifecycle.json")
	var body []byte
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		loaded, err := os.ReadFile(path)
		if err == nil {
			body = loaded
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !strings.Contains(string(body), "\"event\":\"running\"") || !strings.Contains(string(body), "\"generation\":"+itoa(running.Generation)) {
		t.Fatalf("lifecycle %s generation %d", body, running.Generation)
	}
}

func itoa(value uint64) string {
	if value == 0 {
		return "0"
	}
	var digits [20]byte
	index := len(digits)
	for value > 0 {
		index--
		digits[index] = byte('0' + value%10)
		value /= 10
	}
	return string(digits[index:])
}
