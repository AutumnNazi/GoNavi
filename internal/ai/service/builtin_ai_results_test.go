package aiservice

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"GoNavi-Wails/internal/ai"
)

func previewHeading(shown, total int) string {
	return fmt.Sprintf("返回 %d 行，前 %d 行：", total, shown)
}

func queryResultMessage(t *testing.T, rows int) ai.Message {
	t.Helper()
	var data []map[string]any
	for i := 1; i <= rows; i++ {
		data = append(data, map[string]any{"id": i, "name": fmt.Sprintf("胡斌%d", i), "note": nil, "city": "苏|州"})
	}
	encoded, err := json.Marshal(map[string]any{"results": []any{map[string]any{"columns": []string{"id", "name", "city", "note"}, "rowCount": rows, "rows": data}}})
	if err != nil {
		t.Fatal(err)
	}
	return ai.Message{Role: "tool", ToolCallID: "c1", Content: string(encoded)}
}

func TestAQueryResultBecomesAShortTable(t *testing.T) {
	messages := []ai.Message{{Role: "user", Content: "随便找点数据"}, {Role: "assistant", Content: ""}, queryResultMessage(t, 100)}
	got := builtinAIResultPreview(messages, previewHeading)
	want := "返回 100 行，前 10 行：\n\n| id | name | city | note |\n| --- | --- | --- | --- |\n| 1 | 胡斌1 | 苏\\|州 | NULL |"
	if !strings.HasPrefix(got, want) || strings.Count(got, "\n") != 2+1+10 {
		t.Fatalf("got:\n%s", got)
	}
	if few := builtinAIResultPreview([]ai.Message{queryResultMessage(t, 3)}, previewHeading); !strings.HasPrefix(few, "返回 3 行，前 3 行：") {
		t.Fatalf("got:\n%s", few)
	}
}

func TestOnlyATurnThatFollowsAQueryGetsATable(t *testing.T) {
	for name, messages := range map[string][]ai.Message{
		"question":    {{Role: "user", Content: "hi"}},
		"older query": {queryResultMessage(t, 5), {Role: "assistant", Content: "ok"}, {Role: "user", Content: "thanks"}},
		"no rows":     {queryResultMessage(t, 0)},
		"other tool":  {{Role: "tool", Content: `{"tables":["a","b"]}`}},
		"error":       {{Role: "tool", Content: `{"error":"relation does not exist"}`}},
	} {
		if got := builtinAIResultPreview(messages, previewHeading); got != "" {
			t.Errorf("%s: got %q", name, got)
		}
	}
}

// Regression (2026-10-03): the model ran SELECT * FROM dbms_job.lab_customers and answered with
// the SQL again. The person now sees the rows.
func TestAnAnswerAfterAQueryShowsItsRows(t *testing.T) {
	request := ai.ChatRequest{Messages: []ai.Message{{Role: "user", Content: "连接kingbase随便找点数据给我"}, queryResultMessage(t, 100)}}
	run := func(stream []ai.StreamChunk) string {
		inner := &recordingProvider{stream: stream}
		wrapped := builtinAIPromptProvider{Provider: inner, resultHeading: previewHeading}
		var text strings.Builder
		var ended bool
		if err := wrapped.ChatStream(context.Background(), request, func(chunk ai.StreamChunk) {
			if ended {
				t.Errorf("nothing may follow the end: %+v", chunk)
			}
			text.WriteString(chunk.Content)
			ended = chunk.Done
		}); err != nil {
			t.Fatal(err)
		}
		return text.String()
	}

	sqlOnly := run([]ai.StreamChunk{{Content: "SELECT * FROM dbms_job.lab_customers LIMIT 100"}, {Done: true}})
	if !strings.HasPrefix(sqlOnly, "SELECT * FROM dbms_job.lab_customers LIMIT 100\n\n返回 100 行，前 10 行：\n\n| id | name |") {
		t.Fatalf("got:\n%s", sqlOnly)
	}
	withTable := run([]ai.StreamChunk{{Content: "Here:\n| id | name |\n|"}, {Content: "---|---|\n| 1 | a |"}, {Done: true}})
	if strings.Contains(withTable, "返回 100 行") {
		t.Fatalf("an answer with its own table is left alone:\n%s", withTable)
	}
	nextCall := run([]ai.StreamChunk{{ToolCalls: []ai.ToolCall{sqlCall("c2", "SELECT 2")}}, {Done: true}})
	if strings.Contains(nextCall, "返回 100 行") {
		t.Fatalf("a turn that goes on to another call gets no table:\n%s", nextCall)
	}
}

func TestTheNonStreamingAnswerShowsTheRowsToo(t *testing.T) {
	inner := &tableRecordingProvider{answer: "SELECT 1"}
	wrapped := builtinAIPromptProvider{Provider: inner, resultHeading: previewHeading}
	response, err := wrapped.Chat(context.Background(), ai.ChatRequest{Messages: []ai.Message{queryResultMessage(t, 2)}})
	if err != nil || !strings.HasPrefix(response.Content, "SELECT 1\n\n返回 2 行，前 2 行：") {
		t.Fatalf("got %+v %v", response, err)
	}
}

type tableRecordingProvider struct {
	recordingProvider
	answer string
}

func (p *tableRecordingProvider) Chat(_ context.Context, req ai.ChatRequest) (*ai.ChatResponse, error) {
	p.request = req
	return &ai.ChatResponse{Content: p.answer}, nil
}
