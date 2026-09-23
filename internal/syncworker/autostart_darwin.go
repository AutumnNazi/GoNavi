package syncworker

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"os"
	"path/filepath"
)

// Register installs the background worker for subsequent user logins.
func Register(ctx context.Context, root, executable string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	directory := filepath.Join(home, "Library", "LaunchAgents")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	escape := func(value string) string {
		var output bytes.Buffer
		xml.EscapeText(&output, []byte(value))
		return output.String()
	}
	content := `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>` + registrationID(root) + `</string><key>ProgramArguments</key><array><string>` + escape(executable) + `</string><string>sync-worker</string><string>--data-root</string><string>` + escape(root) + `</string></array><key>RunAtLoad</key><true/></dict></plist>`
	return os.WriteFile(filepath.Join(directory, registrationID(root)+".plist"), []byte(content), 0o600)
}

// Unregister removes this data root's login entry before a root migration.
func Unregister(ctx context.Context, root string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	err = os.Remove(filepath.Join(filepath.Join(home, "Library", "LaunchAgents"), registrationID(root)+".plist"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
