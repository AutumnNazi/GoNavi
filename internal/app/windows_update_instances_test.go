package app

import (
	"errors"
	"reflect"
	"testing"
)

func TestWindowsUpdateRequiresExplicitCloseConfirmation(t *testing.T) {
	tests := []struct {
		goos      string
		confirmed bool
		want      bool
	}{
		{goos: "windows", confirmed: false, want: true},
		{goos: " WINDOWS ", confirmed: true, want: false},
		{goos: "darwin", confirmed: false, want: false},
		{goos: "linux", confirmed: false, want: false},
	}
	for _, test := range tests {
		if got := windowsUpdateCloseConfirmationRequired(test.goos, test.confirmed); got != test.want {
			t.Fatalf("windowsUpdateCloseConfirmationRequired(%q, %v) = %v, want %v", test.goos, test.confirmed, got, test.want)
		}
	}
}

func TestCloseOtherWindowsUpdateInstancesForInstallUsesDiscoveredProcesses(t *testing.T) {
	originalFind := updateFindOtherWindowsInstances
	originalClose := updateCloseWindowsInstances
	t.Cleanup(func() {
		updateFindOtherWindowsInstances = originalFind
		updateCloseWindowsInstances = originalClose
	})

	wantTargets := []string{`C:\\Program Files\\GoNavi\\GoNavi.exe`, `C:\\Program Files\\GoNavi\\GoNavi-new.exe`}
	wantProcesses := []windowsUpdateProcess{
		{PID: 101, Executable: wantTargets[0]},
		{PID: 202, Executable: wantTargets[1]},
	}
	findCalls := 0
	updateFindOtherWindowsInstances = func(targets []string, currentPID int) ([]windowsUpdateProcess, error) {
		findCalls++
		if currentPID != 99 {
			t.Fatalf("current PID = %d, want 99", currentPID)
		}
		if !reflect.DeepEqual(targets, wantTargets) {
			t.Fatalf("target paths = %#v, want %#v", targets, wantTargets)
		}
		if findCalls == 1 {
			return wantProcesses, nil
		}
		return nil, nil
	}
	var closed []windowsUpdateProcess
	updateCloseWindowsInstances = func(processes []windowsUpdateProcess) error {
		closed = append([]windowsUpdateProcess(nil), processes...)
		return nil
	}

	pids, err := closeOtherWindowsUpdateInstancesForInstall(wantTargets, 99)
	if err != nil {
		t.Fatalf("closeOtherWindowsUpdateInstancesForInstall returned error: %v", err)
	}
	if !reflect.DeepEqual(closed, wantProcesses) {
		t.Fatalf("closed processes = %#v, want %#v", closed, wantProcesses)
	}
	if !reflect.DeepEqual(pids, []uint32{101, 202}) {
		t.Fatalf("closed PIDs = %#v, want [101 202]", pids)
	}
	if findCalls != 2 {
		t.Fatalf("find calls = %d, want initial discovery and post-close verification", findCalls)
	}
}

func TestCloseOtherWindowsUpdateInstancesForInstallPropagatesCloseFailure(t *testing.T) {
	originalFind := updateFindOtherWindowsInstances
	originalClose := updateCloseWindowsInstances
	t.Cleanup(func() {
		updateFindOtherWindowsInstances = originalFind
		updateCloseWindowsInstances = originalClose
	})

	wantErr := errors.New("access denied")
	updateFindOtherWindowsInstances = func([]string, int) ([]windowsUpdateProcess, error) {
		return []windowsUpdateProcess{{PID: 303, Executable: `C:\\GoNavi.exe`}}, nil
	}
	updateCloseWindowsInstances = func([]windowsUpdateProcess) error { return wantErr }

	pids, err := closeOtherWindowsUpdateInstancesForInstall([]string{`C:\\GoNavi.exe`}, 99)
	if !errors.Is(err, wantErr) {
		t.Fatalf("close error = %v, want %v", err, wantErr)
	}
	if !reflect.DeepEqual(pids, []uint32{303}) {
		t.Fatalf("failed close PIDs = %#v, want [303]", pids)
	}
}
