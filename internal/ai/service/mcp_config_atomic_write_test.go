package aiservice

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type fakeMCPConfigTempFile struct {
	name     string
	chmodErr error
	// writeN >= 0 时返回 writeN 个字节（模拟短写）；< 0 表示完整写入
	writeN   int
	writeErr error
	syncErr  error
	closeErr error
}

// newFullWriteFake 返回默认完整写入的 fake，避免零值 0 恰好是“短写 0 字节”的陷阱。
func newFullWriteFake() *fakeMCPConfigTempFile {
	return &fakeMCPConfigTempFile{writeN: -1}
}

func (f *fakeMCPConfigTempFile) Chmod(mode os.FileMode) error { return f.chmodErr }

func (f *fakeMCPConfigTempFile) Write(p []byte) (int, error) {
	if f.writeErr != nil {
		return 0, f.writeErr
	}
	if f.writeN >= 0 {
		return f.writeN, nil
	}
	return len(p), nil
}

func (f *fakeMCPConfigTempFile) Sync() error { return f.syncErr }

func (f *fakeMCPConfigTempFile) Close() error { return f.closeErr }

func (f *fakeMCPConfigTempFile) Name() string { return f.name }

const (
	mcpAtomicOriginalPayload = "original config bytes\n"
	mcpAtomicNewPayload      = "{\"mcpServers\":{}}\n"
)

// seedMCPAtomicConfig 写入一份原始配置并返回其路径与字节。
func seedMCPAtomicConfig(t *testing.T) (string, []byte) {
	t.Helper()
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")
	original := []byte(mcpAtomicOriginalPayload)
	if err := os.WriteFile(configPath, original, 0o644); err != nil {
		t.Fatalf("seed config: %v", err)
	}
	return configPath, original
}

// restoreMCPAtomicHooks 还原包级注入点，返回替换用的小工具。
func restoreMCPAtomicHooks(t *testing.T) (create func(func(dir string, pattern string) (mcpConfigTempFile, error)), replace func(func(string, string) error)) {
	t.Helper()
	originalCreate := mcpConfigCreateTempFile
	originalReplace := mcpConfigReplace
	t.Cleanup(func() {
		mcpConfigCreateTempFile = originalCreate
		mcpConfigReplace = originalReplace
	})
	return func(fn func(dir string, pattern string) (mcpConfigTempFile, error)) {
			mcpConfigCreateTempFile = fn
		}, func(fn func(string, string) error) {
			mcpConfigReplace = fn
		}
}

func listMCPAtomicTempFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	var names []string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".gonavi-mcp-") && strings.HasSuffix(entry.Name(), ".tmp") {
			names = append(names, entry.Name())
		}
	}
	return names
}

func TestWriteMCPConfigFileAtomicallySuccessKeepsModeAndCleansTemp(t *testing.T) {
	configPath, _ := seedMCPAtomicConfig(t)
	if runtime.GOOS != "windows" {
		if err := os.Chmod(configPath, 0o640); err != nil {
			t.Fatalf("chmod seed: %v", err)
		}
	}

	if err := writeMCPConfigFileAtomically(configPath, []byte(mcpAtomicNewPayload)); err != nil {
		t.Fatalf("atomic write: %v", err)
	}

	updated, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read updated: %v", err)
	}
	if string(updated) != mcpAtomicNewPayload {
		t.Fatalf("updated payload = %q, want %q", updated, mcpAtomicNewPayload)
	}
	if leftovers := listMCPAtomicTempFiles(t, filepath.Dir(configPath)); len(leftovers) != 0 {
		t.Fatalf("temp files left behind: %v", leftovers)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(configPath)
		if err != nil {
			t.Fatalf("stat updated: %v", err)
		}
		if info.Mode().Perm() != 0o640 {
			t.Fatalf("perm = %v, want 0o640 preserved", info.Mode().Perm())
		}
	}
}

func TestWriteMCPConfigFileAtomicallyFailureInjection(t *testing.T) {
	injectCreate, injectReplace := restoreMCPAtomicHooks(t)

	newFake := func(fake *fakeMCPConfigTempFile) {
		injectCreate(func(dir string, pattern string) (mcpConfigTempFile, error) {
			fake.name = filepath.Join(dir, ".gonavi-mcp-fake.tmp")
			return fake, nil
		})
	}

	cases := []struct {
		name    string
		setup   func(fake *fakeMCPConfigTempFile)
		wantErr string
	}{
		{
			name:    "chmod failure",
			setup:   func(fake *fakeMCPConfigTempFile) { fake.chmodErr = errors.New("chmod boom") },
			wantErr: "chmod boom",
		},
		{
			name:    "write failure",
			setup:   func(fake *fakeMCPConfigTempFile) { fake.writeErr = errors.New("write boom") },
			wantErr: "write boom",
		},
		{
			name:    "short write",
			setup:   func(fake *fakeMCPConfigTempFile) { fake.writeN = len(mcpAtomicNewPayload) - 1 },
			wantErr: "short write",
		},
		{
			name:    "sync failure",
			setup:   func(fake *fakeMCPConfigTempFile) { fake.syncErr = errors.New("sync boom") },
			wantErr: "sync boom",
		},
		{
			name:    "close failure",
			setup:   func(fake *fakeMCPConfigTempFile) { fake.closeErr = errors.New("close boom") },
			wantErr: "close boom",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			configPath, original := seedMCPAtomicConfig(t)
			fake := newFullWriteFake()
			tc.setup(fake)
			newFake(fake)
			replaceCalled := false
			injectReplace(func(source string, target string) error {
				replaceCalled = true
				return nil
			})

			err := writeMCPConfigFileAtomically(configPath, []byte(mcpAtomicNewPayload))
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("err = %v, want containing %q", err, tc.wantErr)
			}
			if replaceCalled {
				t.Fatal("replace must not run after a failed temp lifecycle")
			}
			current, readErr := os.ReadFile(configPath)
			if readErr != nil {
				t.Fatalf("read original: %v", readErr)
			}
			if string(current) != string(original) {
				t.Fatalf("original config modified: %q", current)
			}
		})
	}

	t.Run("replace failure keeps original and cleans temp", func(t *testing.T) {
		configPath, original := seedMCPAtomicConfig(t)
		// 重置 create 注入为真实实现：临时文件真实落盘，清理断言才有意义
		injectCreate(func(dir string, pattern string) (mcpConfigTempFile, error) {
			return os.CreateTemp(dir, pattern)
		})
		injectReplace(func(source string, target string) error {
			return errors.New("replace boom")
		})

		err := writeMCPConfigFileAtomically(configPath, []byte(mcpAtomicNewPayload))
		if err == nil || !strings.Contains(err.Error(), "replace boom") {
			t.Fatalf("err = %v, want replace boom", err)
		}
		current, readErr := os.ReadFile(configPath)
		if readErr != nil {
			t.Fatalf("read original: %v", readErr)
		}
		if string(current) != string(original) {
			t.Fatalf("original config modified: %q", current)
		}
		if leftovers := listMCPAtomicTempFiles(t, filepath.Dir(configPath)); len(leftovers) != 0 {
			t.Fatalf("temp files left behind: %v", leftovers)
		}
	})

	t.Run("create temp failure", func(t *testing.T) {
		configPath, original := seedMCPAtomicConfig(t)
		injectCreate(func(dir string, pattern string) (mcpConfigTempFile, error) {
			return nil, errors.New("create boom")
		})

		err := writeMCPConfigFileAtomically(configPath, []byte(mcpAtomicNewPayload))
		if err == nil || !strings.Contains(err.Error(), "create boom") {
			t.Fatalf("err = %v, want create boom", err)
		}
		current, readErr := os.ReadFile(configPath)
		if readErr != nil {
			t.Fatalf("read original: %v", readErr)
		}
		if string(current) != string(original) {
			t.Fatalf("original config modified: %q", current)
		}
	})
}
