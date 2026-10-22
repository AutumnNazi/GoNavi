package plugin

import (
	"io"
	"strings"
	"testing"
	"time"
)

func TestRPCReaderRejectsOversizedMultibyteFrame(t *testing.T) {
	process := &rpcProcess{
		stdout:  io.NopCloser(strings.NewReader(strings.Repeat("文", 400000) + "\n")),
		failed:  make(chan struct{}),
		pending: map[uint64]rpcPending{},
	}
	process.workers.Add(1)
	go process.readProtocol()
	select {
	case <-process.failed:
	case <-time.After(5 * time.Second):
		t.Fatal("oversized frame did not fail the protocol")
	}
	process.workers.Wait()
	if err := process.failure(); err == nil || !strings.Contains(err.Error(), "oversized") {
		t.Fatal(err)
	}
}
