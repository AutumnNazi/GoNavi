package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"GoNavi-Wails/internal/market"
)

type releaseSyncStub struct {
	run func(context.Context) ([]market.SyncOutcome, error)
}

func (s releaseSyncStub) SyncAllReleases(ctx context.Context) ([]market.SyncOutcome, error) {
	return s.run(ctx)
}

func TestSyncOnceInheritsParentCancellation(t *testing.T) {
	for _, test := range []struct {
		name     string
		deadline bool
		want     error
	}{
		{name: "canceled", want: context.Canceled},
		{name: "deadline exceeded", deadline: true, want: context.DeadlineExceeded},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			if test.deadline {
				cancel()
				ctx, cancel = context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
			} else {
				cancel()
			}
			defer cancel()
			var got error
			syncOnce(ctx, releaseSyncStub{run: func(syncCtx context.Context) ([]market.SyncOutcome, error) {
				got = syncCtx.Err()
				return nil, got
			}})
			if !errors.Is(got, test.want) {
				t.Fatalf("sync context error = %v, want %v", got, test.want)
			}
		})
	}
}

func TestSyncOnceCancelsInFlightPass(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		syncOnce(ctx, releaseSyncStub{run: func(syncCtx context.Context) ([]market.SyncOutcome, error) {
			close(started)
			<-syncCtx.Done()
			return nil, syncCtx.Err()
		}})
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("sync pass did not start")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("sync pass ignored parent cancellation")
	}
}

func TestReleaseSyncWorkerStopsBeforeStartup(t *testing.T) {
	for _, parentCanceled := range []bool{false, true} {
		name := "explicit stop"
		if parentCanceled {
			name = "parent canceled"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			called := make(chan struct{}, 1)
			stop := startReleaseSync(ctx, releaseSyncStub{run: func(context.Context) ([]market.SyncOutcome, error) {
				called <- struct{}{}
				return nil, nil
			}})
			if parentCanceled {
				cancel()
			}
			done := make(chan struct{})
			go func() {
				stop()
				close(done)
			}()
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("sync worker did not stop")
			}
			select {
			case <-called:
				t.Fatal("sync ran before the startup delay")
			default:
			}
		})
	}
}

func TestSyncOnceBoundsDeadline(t *testing.T) {
	for _, parentLimit := range []time.Duration{0, time.Minute} {
		t.Run(parentLimit.String(), func(t *testing.T) {
			ctx := context.Background()
			if parentLimit > 0 {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, parentLimit)
				defer cancel()
			}
			before := time.Now()
			syncOnce(ctx, releaseSyncStub{run: func(syncCtx context.Context) ([]market.SyncOutcome, error) {
				deadline, ok := syncCtx.Deadline()
				if !ok || !deadline.After(before) || deadline.After(time.Now().Add(10*time.Minute)) {
					t.Fatalf("invalid sync deadline: %v, present: %v", deadline, ok)
				}
				if parentDeadline, ok := ctx.Deadline(); ok && !deadline.Equal(parentDeadline) {
					t.Fatalf("sync deadline = %v, parent deadline = %v", deadline, parentDeadline)
				}
				return nil, nil
			}})
		})
	}
}
