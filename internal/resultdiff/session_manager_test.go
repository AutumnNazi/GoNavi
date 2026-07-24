package resultdiff

import (
	"sync"
	"testing"
	"time"
)

type managerTestClock struct {
	now time.Time
}

func (c *managerTestClock) Now() time.Time {
	return c.now
}

func (c *managerTestClock) Advance(delta time.Duration) {
	c.now = c.now.Add(delta)
}

func TestManagerPruneExpiredWithoutFollowupActivity(t *testing.T) {
	clock := &managerTestClock{now: time.Date(2026, time.July, 22, 12, 0, 0, 0, time.UTC)}
	manager := newManagerWithClock(time.Minute, clock.Now)
	session := manager.Create(StartRequest{KeyColumns: []string{"id"}})

	clock.Advance(time.Minute + time.Nanosecond)
	if removed := manager.PruneExpired(clock.Now()); removed != 1 {
		t.Fatalf("PruneExpired removed %d sessions, want 1", removed)
	}
	if removed := manager.PruneExpired(clock.Now()); removed != 0 {
		t.Fatalf("second PruneExpired removed %d sessions, want 0", removed)
	}
	if _, err := manager.Get(session.ID); err == nil {
		t.Fatal("expired session is still reachable after proactive prune")
	}
}

func TestManagerPruneExpiredKeepsRecentlyAccessedSession(t *testing.T) {
	clock := &managerTestClock{now: time.Date(2026, time.July, 22, 12, 0, 0, 0, time.UTC)}
	manager := newManagerWithClock(time.Minute, clock.Now)
	session := manager.Create(StartRequest{KeyColumns: []string{"id"}})

	clock.Advance(45 * time.Second)
	if _, err := manager.Get(session.ID); err != nil {
		t.Fatalf("Get active session: %v", err)
	}
	clock.Advance(45 * time.Second)
	if removed := manager.PruneExpired(clock.Now()); removed != 0 {
		t.Fatalf("PruneExpired removed %d recently accessed sessions, want 0", removed)
	}

	clock.Advance(time.Minute + time.Nanosecond)
	if removed := manager.PruneExpired(clock.Now()); removed != 1 {
		t.Fatalf("PruneExpired removed %d idle sessions after refreshed TTL, want 1", removed)
	}
}

func TestManagerSessionActivityRefreshesTTL(t *testing.T) {
	clock := &managerTestClock{now: time.Date(2026, time.July, 22, 12, 0, 0, 0, time.UTC)}
	manager := newManagerWithClock(time.Minute, clock.Now)
	session := manager.Create(StartRequest{KeyColumns: []string{"id"}, MaxRowsPerSide: 10})

	clock.Advance(45 * time.Second)
	if err := session.AppendRows("left", []string{"id"}, []map[string]interface{}{{"id": 1}}, false); err != nil {
		t.Fatalf("AppendRows: %v", err)
	}
	clock.Advance(45 * time.Second)
	if removed := manager.PruneExpired(clock.Now()); removed != 0 {
		t.Fatalf("PruneExpired removed %d active upload sessions, want 0", removed)
	}
}

func TestManagerPruneExpiredSkipsOperationInProgress(t *testing.T) {
	clock := &managerTestClock{now: time.Date(2026, time.July, 22, 12, 0, 0, 0, time.UTC)}
	manager := newManagerWithClock(time.Minute, clock.Now)
	session := manager.Create(StartRequest{KeyColumns: []string{"id"}})

	finishActivity := session.beginActivity()
	defer finishActivity()
	clock.Advance(2 * time.Minute)
	if removed := manager.PruneExpired(clock.Now()); removed != 0 {
		t.Fatalf("PruneExpired removed %d sessions with an operation in progress, want 0", removed)
	}
}

func TestManagerCreateWithLeaseProtectsLongInitialLoad(t *testing.T) {
	clock := &managerTestClock{now: time.Date(2026, time.July, 22, 12, 0, 0, 0, time.UTC)}
	manager := newManagerWithClock(time.Minute, clock.Now)
	session, release := manager.CreateWithLease(StartRequest{KeyColumns: []string{"id"}})
	if session == nil {
		t.Fatal("CreateWithLease returned nil session before shutdown")
	}

	clock.Advance(2 * time.Minute)
	if removed := manager.PruneExpired(clock.Now()); removed != 0 {
		t.Fatalf("PruneExpired removed %d sessions during initial load lease, want 0", removed)
	}
	release()
	release()
	if _, activeOperations := session.activityState(); activeOperations != 0 {
		t.Fatalf("idempotent lease release left %d active operations, want 0", activeOperations)
	}
	clock.Advance(time.Minute + time.Nanosecond)
	if removed := manager.PruneExpired(clock.Now()); removed != 1 {
		t.Fatalf("PruneExpired removed %d sessions after initial load became idle, want 1", removed)
	}
}

func TestManagerCloseAllReleasesEverySession(t *testing.T) {
	manager := NewManager(time.Hour)
	first := manager.Create(StartRequest{KeyColumns: []string{"id"}})
	second := manager.Create(StartRequest{KeyColumns: []string{"id"}})

	if closed := manager.CloseAll(); closed != 2 {
		t.Fatalf("CloseAll closed %d sessions, want 2", closed)
	}
	if closed := manager.CloseAll(); closed != 0 {
		t.Fatalf("second CloseAll closed %d sessions, want 0", closed)
	}
	for _, jobID := range []string{first.ID, second.ID} {
		if _, err := manager.Get(jobID); err == nil {
			t.Fatalf("session %s is still reachable after CloseAll", jobID)
		}
	}
	if replacement := manager.Create(StartRequest{KeyColumns: []string{"id"}}); replacement == nil {
		t.Fatal("CloseAll unexpectedly made the manager terminal")
	}
}

func TestManagerShutdownRejectsNewSessions(t *testing.T) {
	manager := NewManager(time.Hour)
	existing := manager.Create(StartRequest{KeyColumns: []string{"id"}})

	if closed := manager.Shutdown(); closed != 1 {
		t.Fatalf("Shutdown closed %d sessions, want 1", closed)
	}
	if closed := manager.Shutdown(); closed != 0 {
		t.Fatalf("second Shutdown closed %d sessions, want 0", closed)
	}
	if manager.Create(StartRequest{KeyColumns: []string{"id"}}) != nil {
		t.Fatal("Create accepted a session after shutdown")
	}
	if session, release := manager.CreateWithLease(StartRequest{KeyColumns: []string{"id"}}); session != nil {
		release()
		t.Fatal("CreateWithLease accepted a session after shutdown")
	}
	if _, err := manager.Get(existing.ID); err == nil {
		t.Fatal("Get accepted a session after shutdown")
	}
}

func TestManagerShutdownPreventsConcurrentSessionResurrection(t *testing.T) {
	manager := NewManager(time.Hour)
	const workerCount = 32
	start := make(chan struct{})
	var workers sync.WaitGroup
	workers.Add(workerCount)
	for index := 0; index < workerCount; index++ {
		go func() {
			defer workers.Done()
			<-start
			manager.Create(StartRequest{KeyColumns: []string{"id"}})
		}()
	}

	close(start)
	manager.Shutdown()
	workers.Wait()
	if remaining := manager.Shutdown(); remaining != 0 {
		t.Fatalf("shutdown left %d concurrently created sessions reachable", remaining)
	}
	if manager.Create(StartRequest{KeyColumns: []string{"id"}}) != nil {
		t.Fatal("Create resurrected manager after concurrent shutdown")
	}
}
