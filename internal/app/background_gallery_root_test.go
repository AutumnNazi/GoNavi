package app

import (
	"context"
	"testing"
	"time"

	"GoNavi-Wails/internal/backgroundgallery"
	"GoNavi-Wails/internal/connection"
)

func TestBackgroundGalleryRootSwitchDrainsDownloadsAndRejectsRacingWork(t *testing.T) {
	a, started, _ := newBlockingGalleryApp(t)
	result := make(chan connection.QueryResult, 1)
	go func() { result <- a.BackgroundGalleryDownload("test-background", "1", "root-change") }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("download did not start")
	}
	resume, err := a.suspendBackgroundGallery()
	if err != nil {
		t.Fatal(err)
	}
	resumed := false
	defer func() {
		if !resumed {
			resume()
		}
	}()
	select {
	case value := <-result:
		if value.Success {
			t.Fatal("old-root download must not succeed after suspension")
		}
	case <-time.After(time.Second):
		t.Fatal("suspension did not drain download")
	}
	if value := a.BackgroundGalleryStatus(); value.Success {
		t.Fatal("work admitted while root migration is suspended")
	}
	a.configDir = t.TempDir()
	resume()
	resumed = true
	state := a.BackgroundGalleryStatus()
	if !state.Success {
		t.Fatalf("new-root local status: %#v", state)
	}
	if installed := state.Data.(backgroundgallery.State).Installed; len(installed) != 0 {
		t.Fatalf("old-root images leaked into new root: %#v", installed)
	}
}

func TestBackgroundGalleryRootSuspendClosesRegistrationRace(t *testing.T) {
	a, _, _ := newBlockingGalleryApp(t)
	release, err := a.beginBackgroundGalleryOperation()
	if err != nil {
		t.Fatal(err)
	}
	suspended := make(chan func(), 1)
	go func() {
		resume, err := a.suspendBackgroundGallery()
		if err == nil {
			suspended <- resume
		}
	}()
	// Observe admission closure, not a timing-based guess about the writer lock.
	deadline := time.After(2 * time.Second)
	for {
		a.backgroundGallery.mu.Lock()
		paused := a.backgroundGallery.paused
		a.backgroundGallery.mu.Unlock()
		if paused {
			break
		}
		select {
		case <-deadline:
			release()
			t.Fatal("suspension did not close admission")
		case <-time.After(time.Millisecond):
		}
	}
	ctx, finish, err := a.beginBackgroundGalleryRequest(context.Background(), "late-registration")
	if err == nil {
		finish()
		release()
		t.Fatalf("registration after pause accepted: %v", ctx)
	}
	release()
	select {
	case resume := <-suspended:
		resume()
	case <-time.After(time.Second):
		t.Fatal("suspension did not finish after the active reader left")
	}
}
