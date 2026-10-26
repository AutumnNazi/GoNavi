package plugin

import (
	"context"
	"fmt"
	"time"
)

// armReplyDeadline belongs to the pending response, not the caller's wait context.
// A canceled caller cannot abandon the watchdog or release credits for output still in flight.
func (p *rpcProcess) armReplyDeadline(id uint64, policy rpcCallPolicy) {
	if policy.dispatchTimeout <= 0 {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	call, ok := p.pending[id]
	if !ok || p.terminal != nil {
		return
	}
	cause := policy.timeoutError
	if cause == nil {
		cause = fmt.Errorf("plugin reply deadline exceeded: %w", context.DeadlineExceeded)
	}
	call.watchdog = time.AfterFunc(policy.dispatchTimeout, func() { p.failPending(cause, id) })
	p.pending[id] = call
}
