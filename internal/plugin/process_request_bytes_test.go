package plugin

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestRPCCallRejectsOversizedMultibyteRequest(t *testing.T) {
	process := &rpcProcess{pending: map[uint64]rpcPending{}, outgoing: make(chan []byte, 1)}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := process.callBounded(ctx, "plugin.invoke", strings.Repeat("文", 400000), rpcCallPolicy{})
	if err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatal(err)
	}
	select {
	case frame := <-process.outgoing:
		t.Fatalf("oversized request was queued: %d", len(frame))
	default:
	}
}
