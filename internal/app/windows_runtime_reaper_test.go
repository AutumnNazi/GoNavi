package app

import (
	"slices"
	"testing"
)

func TestCommandLineUsesUserDataDirRequiresMarkerBoundary(t *testing.T) {
	marker := `C:\Users\me\AppData\Roaming\GoNavi\WebView2`
	tests := []struct {
		name    string
		command string
		known   bool
		want    bool
	}{
		{
			name:    "quoted user data dir",
			command: `msedgewebview2.exe --embedded-browser-webview=1 --user-data-dir="C:\Users\me\AppData\Roaming\GoNavi\WebView2"`,
			known:   true,
			want:    true,
		},
		{
			name:    "parent directory also matches the webview folder",
			command: `msedgewebview2.exe --user-data-dir=C:\Users\me\AppData\Roaming\GoNavi\WebView2`,
			known:   true,
			want:    true,
		},
		{
			name:    "prefix of another directory does not match",
			command: `msedgewebview2.exe --user-data-dir=C:\Users\me\AppData\Roaming\GoNavi-other`,
			known:   true,
			want:    false,
		},
		{
			name:    "path without the webview switch does not match",
			command: `notepad.exe C:\Users\me\AppData\Roaming\GoNavi\WebView2\lock`,
			known:   true,
			want:    false,
		},
		{
			name:    "unknown command line does not match",
			command: `msedgewebview2.exe --user-data-dir=` + marker,
			known:   false,
			want:    false,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := commandLineUsesUserDataDir(test.command, test.known, []string{marker, `C:\Users\me\AppData\Roaming\GoNavi`})
			if got != test.want {
				t.Fatalf("commandLineUsesUserDataDir() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestSelectOrphanWebViewTargetsLeavesLiveHostTree(t *testing.T) {
	marker := `C:\Users\me\AppData\Roaming\GoNavi\WebView2`
	liveCommand := `msedgewebview2.exe --user-data-dir=` + marker
	nodes := []runtimeProcess{
		{PID: 10, ParentPID: 1, ImageName: "gonavi.exe"},
		{PID: 20, ParentPID: 10, ImageName: windowsWebViewImageName, CommandLine: liveCommand, CommandLineKnown: true},
		{PID: 21, ParentPID: 20, ImageName: windowsWebViewImageName, CommandLine: liveCommand, CommandLineKnown: true},
		{PID: 30, ParentPID: 1, ImageName: "explorer.exe"},
		{PID: 40, ParentPID: 30, ImageName: windowsWebViewImageName, CommandLine: liveCommand, CommandLineKnown: true},
		{PID: 41, ParentPID: 40, ImageName: windowsWebViewImageName},
		{PID: 50, ParentPID: 1, ImageName: "gonavi.exe"},
		{PID: 60, ParentPID: 30, ImageName: windowsWebViewImageName, CommandLine: `msedgewebview2.exe --user-data-dir=C:\Other`, CommandLineKnown: true},
	}

	got := selectOrphanWebViewTargets(nodes, windowsWebViewImageName, map[string]struct{}{"gonavi.exe": {}}, []string{marker})
	want := []uint32{41, 40}
	if !slices.Equal(got, want) {
		t.Fatalf("orphan targets = %v, want %v", got, want)
	}
}

func TestSelectOrphanRuntimeTargetsIncludesDetachedHostTree(t *testing.T) {
	nodes := []runtimeProcess{
		{PID: 1, ParentPID: 0, ImageName: "explorer.exe"},
		{PID: 10, ParentPID: 1, ImageName: "gonavi.exe", CommandLine: `GoNavi.exe detached-window`, CommandLineKnown: true},
		{PID: 11, ParentPID: 10, ImageName: windowsWebViewImageName},
		{PID: 12, ParentPID: 10, ImageName: "gonavi.exe", CommandLine: `GoNavi.exe --gonavi-reap-runtime-processes 10`, CommandLineKnown: true},
		{PID: 20, ParentPID: 1, ImageName: "gonavi.exe", CommandLine: `GoNavi.exe`, CommandLineKnown: true},
		{PID: 21, ParentPID: 20, ImageName: "gonavi.exe", CommandLine: `GoNavi.exe --detached-window`, CommandLineKnown: true},
	}

	got := selectOrphanRuntimeTargets(nodes, windowsWebViewImageName, map[string]struct{}{"gonavi.exe": {}}, nil)
	want := []uint32{11, 10}
	if !slices.Equal(got, want) {
		t.Fatalf("orphan runtime targets = %v, want %v", got, want)
	}
}

func TestReapKillOrderKillsChildrenBeforeParents(t *testing.T) {
	nodes := []runtimeProcess{
		{PID: 1, ParentPID: 0},
		{PID: 2, ParentPID: 1},
		{PID: 3, ParentPID: 2},
	}
	got := reapKillOrder(nodes, []uint32{1, 3, 2, 3})
	want := []uint32{3, 2, 1}
	if !slices.Equal(got, want) {
		t.Fatalf("kill order = %v, want %v", got, want)
	}
}
