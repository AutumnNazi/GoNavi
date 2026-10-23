package plugin

import (
	"context"
	"math"
	"sync"
	"time"
)

const aiReplySlots = 8
const aiControlSlots = 2
const aiReplyBytes = 1 << 20
const aiPullReplyBytes = (128 << 10) + 1024
const aiControlReplyBytes = 1024
const aiFramesPerSecond = 72
const aiFrameBurst = 16
const aiBytesPerSecond = 2 << 20
const aiByteBurst = 1 << 20
const aiMaxWaiters = 64
const aiMaxControlWaiters = 16 // Accommodate bounded cleanup for all 16 active SDK workers.
const aiCancelTimeout = 250 * time.Millisecond
const aiAdmissionTimeout = 30 * time.Second

// aiProviderBudget belongs to one process generation, shared across all its providers.
// Credits survive caller cancellation; FIFO tickets prevent new pulls from starving old ones.
type aiProviderBudget struct {
	mu                                  sync.Mutex
	initialized                         bool
	last                                time.Time
	frames, bytes                       float64
	pending, normal, controls, reserved int
	waiters, cancelWaiters              int
	changed                             chan struct{}
	normalQueue, controlQueue           []*aiBudgetWaiter
}

type aiBudgetWaiter struct{ control bool }
type aiReplyCredit struct {
	once    sync.Once
	budget  *aiProviderBudget
	bytes   int
	control bool
}

func (b *aiProviderBudget) initializeLocked(now time.Time) {
	if b.initialized {
		return
	}
	b.initialized = true
	b.last = now
	b.frames = aiFrameBurst
	b.bytes = aiByteBurst
	b.changed = make(chan struct{}) // Broadcast wakes bounded waiters; only each lane's head may acquire.
}
func (b *aiProviderBudget) refillLocked(now time.Time) {
	b.initializeLocked(now)
	elapsed := now.Sub(b.last).Seconds()
	if elapsed <= 0 {
		return
	}
	b.frames = math.Min(aiFrameBurst, b.frames+elapsed*aiFramesPerSecond)
	b.bytes = math.Min(aiByteBurst, b.bytes+elapsed*aiBytesPerSecond)
	b.last = now
}
func (b *aiProviderBudget) signalLocked() { close(b.changed); b.changed = make(chan struct{}) }

func (b *aiProviderBudget) beginWait(control bool) (*aiBudgetWaiter, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.initializeLocked(time.Now())
	if (control && len(b.controlQueue) >= aiMaxControlWaiters) || (!control && len(b.normalQueue) >= aiMaxWaiters) {
		return nil, ErrBusy
	}
	waiter := &aiBudgetWaiter{control: control}
	b.waiters++
	if control {
		b.cancelWaiters++
		b.controlQueue = append(b.controlQueue, waiter)
	} else {
		b.normalQueue = append(b.normalQueue, waiter)
	}
	b.signalLocked()
	return waiter, nil
}
func (b *aiProviderBudget) endWait(waiter *aiBudgetWaiter) {
	b.mu.Lock()
	defer b.mu.Unlock()
	queue := &b.normalQueue
	if waiter.control {
		queue = &b.controlQueue
	}
	for index, item := range *queue {
		if item == waiter {
			copy((*queue)[index:], (*queue)[index+1:])
			(*queue)[len(*queue)-1] = nil
			*queue = (*queue)[:len(*queue)-1]
			b.waiters--
			if waiter.control {
				b.cancelWaiters--
			}
			b.signalLocked()
			return
		}
	}
}

func (b *aiProviderBudget) acquire(ctx context.Context, bytes int, control bool) (*aiReplyCredit, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	waiter, err := b.beginWait(control)
	if err != nil {
		if canceled := ctx.Err(); canceled != nil {
			return nil, canceled
		}
		return nil, err
	}
	defer b.endWait(waiter)
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		b.mu.Lock()
		b.refillLocked(time.Now())
		capacity := b.pending < aiReplySlots && b.reserved+bytes <= aiReplyBytes
		if control {
			capacity = capacity && b.controls < aiControlSlots && len(b.controlQueue) > 0 && b.controlQueue[0] == waiter
		} else {
			capacity = capacity && b.normal < aiReplySlots-aiControlSlots && b.cancelWaiters == 0 && len(b.normalQueue) > 0 && b.normalQueue[0] == waiter
		}
		frameNeed, byteNeed := float64(1), float64(bytes)
		if !control {
			frameNeed += aiControlSlots
			byteNeed += aiControlSlots * aiControlReplyBytes
		}
		if capacity && b.frames >= frameNeed && b.bytes >= byteNeed {
			b.frames--
			b.bytes -= float64(bytes)
			b.pending++
			b.reserved += bytes
			if control {
				b.controls++
			} else {
				b.normal++
			}
			b.mu.Unlock()
			return &aiReplyCredit{budget: b, bytes: bytes, control: control}, nil
		}
		changed := b.changed
		delay := time.Duration(0)
		if capacity {
			seconds := math.Max((frameNeed-b.frames)/aiFramesPerSecond, (byteNeed-b.bytes)/aiBytesPerSecond)
			delay = time.Duration(math.Ceil(seconds * float64(time.Second)))
			if delay < time.Millisecond {
				delay = time.Millisecond
			}
		}
		b.mu.Unlock()
		if err := waitAIAdmission(ctx, changed, delay); err != nil {
			return nil, err
		}
	}
}

func waitAIAdmission(ctx context.Context, changed <-chan struct{}, delay time.Duration) error {
	if delay == 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-changed:
			return nil
		}
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-changed:
		return nil
	case <-timer.C:
		return nil
	}
}
func (c *aiReplyCredit) release() {
	c.once.Do(func() {
		b := c.budget
		b.mu.Lock()
		defer b.mu.Unlock()
		b.pending--
		b.reserved -= c.bytes
		if c.control {
			b.controls--
		} else {
			b.normal--
		}
		b.signalLocked()
	})
}
