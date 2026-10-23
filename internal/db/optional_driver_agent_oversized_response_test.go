package db

import (
	"bufio"
	"errors"
	"strings"
	"testing"
)

// TestOptionalDriverAgentClientKeepsTransportAfterAgentOversizeFailure 覆盖缓冲（非流式）路径：
// agent 结果超过单帧上限时会改写一条小的失败帧，帧边界仍然可信，transport 必须继续可用。
// 此前只有流式路径这样处理；DBQuery 走缓冲路径，一次超大的详情查询会让连接直到
// 下次 ping 重建前都不可用。
func TestOptionalDriverAgentClientKeepsTransportAfterAgentOversizeFailure(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	stdout := strings.Join([]string{
		`{"id":1,"success":false,"error":"` + ErrOptionalDriverAgentJSONLineTooLarge.Error() + `"}`,
		`{"id":2,"success":true}`,
	}, "\n") + "\n"
	client := &optionalDriverAgentClient{
		stdin:  &stdin,
		reader: bufio.NewReader(strings.NewReader(stdout)),
		driver: "kafka",
	}

	err := client.call(optionalAgentRequest{Method: optionalAgentMethodQuery, Query: `SELECT * FROM "big"`}, nil, nil, nil, nil)
	if !errors.Is(err, ErrOptionalDriverAgentJSONLineTooLarge) {
		t.Fatalf("oversize failure = %v, want ErrOptionalDriverAgentJSONLineTooLarge", err)
	}
	if stopped := client.stoppedError(); stopped != nil {
		t.Fatalf("transport must stay usable after an agent-side oversize failure: %v", stopped)
	}
	if err := client.call(optionalAgentRequest{Method: optionalAgentMethodPing}, nil, nil, nil, nil); err != nil {
		t.Fatalf("next request should succeed: %v", err)
	}
}

// applyChanges 的写入可能已在数据库生效，只是响应超限发不回来：结果必须标记为未知。
func TestOptionalDriverAgentClientMarksApplyChangesUnknownOnOversizeFailure(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	stdout := `{"id":1,"success":false,"error":"` + ErrOptionalDriverAgentJSONLineTooLarge.Error() + `"}` + "\n"
	client := &optionalDriverAgentClient{
		stdin:  &stdin,
		reader: bufio.NewReader(strings.NewReader(stdout)),
		driver: "kafka",
	}
	err := client.call(optionalAgentRequest{Method: optionalAgentMethodApplyChanges}, nil, nil, nil, nil)
	if !errors.Is(err, ErrOptionalDriverAgentJSONLineTooLarge) || !IsWriteOutcomeUnknown(err) {
		t.Fatalf("applyChanges oversize failure = %v, want unknown outcome", err)
	}
}

func TestIsOptionalAgentOversizeFailure(t *testing.T) {
	for text, want := range map[string]bool{
		ErrOptionalDriverAgentJSONLineTooLarge.Error(): true,
		"驱动代理 JSON Lines 单帧超过 64 MiB 上限":               true,
		"  驱动代理 JSON Lines 单帧超过 32 MiB 上限 ":            true,
		"连接被拒绝": false,
		"":      false,
	} {
		if got := isOptionalAgentOversizeFailure(text); got != want {
			t.Fatalf("isOptionalAgentOversizeFailure(%q) = %v, want %v", text, got, want)
		}
	}
}
