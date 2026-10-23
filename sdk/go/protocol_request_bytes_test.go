package plugin

import (
	"context"
	"strings"
	"testing"
)

func TestReadLoopRejectsOversizedMultibyteRequest(t *testing.T) {
	session := &session{options: Options{MaxFrameBytes: DefaultMaxFrameBytes}}
	err := session.readLoop(context.Background(), strings.NewReader(strings.Repeat("文", 400000)+"\n"))
	if err == nil || !strings.Contains(err.Error(), "frame") {
		t.Fatal(err)
	}
}
