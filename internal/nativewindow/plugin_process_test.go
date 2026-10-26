package nativewindow

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestPluginProcessHelper(t *testing.T) {
	mode := os.Getenv("GONAVI_PLUGIN_TEST_MODE")
	if mode == "" {
		return
	}
	if mode == "normal" {
		os.Exit(0)
	}
	if mode == "crash" {
		os.Exit(7)
	}
	if mode == "tree" {
		child := exec.Command(os.Args[0], "-test.run=^TestPluginProcessHelper$")
		child.Env = append(pluginChildEnvironment(os.Environ(), os.Getenv("GONAVI_PLUGIN_TEST_DIR")),
			"GONAVI_PLUGIN_TEST_MODE=hang", "GONAVI_PLUGIN_TEST_DIR="+os.Getenv("GONAVI_PLUGIN_TEST_DIR"))
		child.Dir = os.Getenv("GONAVI_PLUGIN_TEST_DIR")
		if err := child.Start(); err != nil {
			os.Exit(8)
		}
		if err := os.WriteFile(filepath.Join(child.Dir, "descendant.pid"), []byte(strconv.Itoa(child.Process.Pid)), 0600); err != nil {
			os.Exit(9)
		}
	}
	if err := os.WriteFile(filepath.Join(os.Getenv("GONAVI_PLUGIN_TEST_DIR"), fmt.Sprintf("%d.ready", os.Getpid())), []byte("ready"), 0600); err != nil {
		os.Exit(10)
	}
	if mode == "watchdog" {
		quitPluginChild(func() {
			for {
				time.Sleep(time.Second)
			}
		})
	}
	for {
		time.Sleep(time.Second)
	}
}

func pluginHelperSpec(t *testing.T, mode string) pluginProcessSpec {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	env := pluginChildEnvironment(os.Environ(), directory)
	env = append(env, "GONAVI_PLUGIN_TEST_MODE="+mode, "GONAVI_PLUGIN_TEST_DIR="+directory)
	return pluginProcessSpec{executable: executable, args: []string{"-test.run=^TestPluginProcessHelper$"}, env: env, directory: directory}
}

func awaitPluginFile(t *testing.T, path string) []byte {
	t.Helper()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(5 * time.Second)
	defer timeout.Stop()
	for {
		select {
		case <-ticker.C:
			if bytes, err := os.ReadFile(path); err == nil && len(bytes) > 0 {
				return bytes
			}
		case <-timeout.C:
			t.Fatalf("helper did not create %s", path)
		}
	}
}

func TestPluginRealProcessExitAndCrash(t *testing.T) {
	for _, mode := range []string{"normal", "crash", "watchdog"} {
		t.Run(mode, func(t *testing.T) {
			process, err := startPluginProcess(pluginHelperSpec(t, mode))
			if err != nil {
				t.Fatal(err)
			}
			if process.PID() == os.Getpid() {
				t.Fatal("plugin did not use separate process")
			}
			// One result is buffered so timeout cleanup cannot strand the waiter.
			done := make(chan error, 1)
			go func() { done <- process.Wait() }()
			select {
			case err := <-done:
				if (mode == "normal") != (err == nil) {
					t.Fatalf("mode=%s wait=%v", mode, err)
				}
			case <-time.After(5 * time.Second):
				if err := process.Kill(); err != nil {
					t.Error(err)
				}
				t.Fatal("process did not exit")
			}
		})
	}
}

func TestPluginRealProcessKillAndReap(t *testing.T) {
	spec := pluginHelperSpec(t, "hang")
	process, err := startPluginProcess(spec)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- process.Wait() }()
	t.Cleanup(func() {
		if err := process.Kill(); err != nil {
			t.Error(err)
		}
	})
	awaitPluginFile(t, filepath.Join(spec.directory, fmt.Sprintf("%d.ready", process.PID())))
	if err := process.Kill(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("killed child not reaped")
	}
}

func TestPluginChildEnvironmentNeverInheritsHostCredentials(t *testing.T) {
	profile := t.TempDir()
	parent := []string{"GONAVI_DETACHED_TOKEN=host-secret", "GONAVI_TOKEN=host-secret", "AWS_SECRET_ACCESS_KEY=cloud-secret", "PATH=custom-bin", "NODE_OPTIONS=--require malicious.js", "WEBVIEW2_USER_DATA_FOLDER=main-profile", "HOME=main-home", "frontenddevserverurl=http://evil", "DISPLAY=:0", "LANG=en_US.UTF-8"}
	result := strings.Join(pluginChildEnvironment(parent, profile), "\n")
	for _, secret := range []string{"host-secret", "cloud-secret", "custom-bin", "main-profile", "main-home", "malicious.js", "http://evil"} {
		if strings.Contains(result, secret) {
			t.Fatalf("inherited %q", secret)
		}
	}
	for _, expected := range []string{"DISPLAY=:0", "LANG=en_US.UTF-8", "HOME=" + profile, "XDG_DATA_HOME=" + filepath.Join(profile, "data")} {
		if !strings.Contains(result, expected) {
			t.Fatalf("missing %s", expected)
		}
	}
}
