package syncworker

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Register installs the background worker for subsequent desktop logins.
func Register(ctx context.Context, root, executable string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	directory, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	directory = filepath.Join(directory, "autostart")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	content := "[Desktop Entry]\nType=Application\nName=GoNavi Sync\nTerminal=false\nNoDisplay=true\nExec=" + desktopExecArgument(executable) + " sync-worker --data-root " + desktopExecArgument(root) + "\n"
	return os.WriteFile(filepath.Join(directory, registrationID(root)+".desktop"), []byte(content), 0o600)
}

func desktopExecArgument(value string) string {
	return `"` + strings.NewReplacer(
		`\`, `\\\\`, `"`, `\\"`, "`", "\\\\`", "$", `\\$`, "%", "%%", "\n", `\n`, "\r", `\r`,
	).Replace(value) + `"`
}

// Unregister removes this data root's login entry before a root migration.
func Unregister(ctx context.Context, root string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	home, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	err = os.Remove(filepath.Join(filepath.Join(home, "autostart"), registrationID(root)+".desktop"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
