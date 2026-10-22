package plugin

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestAIProviderStreamsBeforeGenerateReturnsAndOutlivesStartContext(t *testing.T) {
	first, release := make(chan struct{}), make(chan struct{})
	d := aiTestDispatcher(t, AIProviderLimits{PullWait: 20 * time.Millisecond}, func(ctx context.Context, start AIProviderStart, emit AIProviderEmit) (AIProviderCompletion, error) {
		if start.Config.APIKey != "private-api-key" {
			return AIProviderCompletion{}, errors.New("wrong selected config")
		}
		if err := emit(AIProviderDelta{Content: "first"}); err != nil {
			return AIProviderCompletion{}, err
		}
		close(first)
		select {
		case <-ctx.Done():
			return AIProviderCompletion{}, ctx.Err()
		case <-release:
		}
		if err := emit(AIProviderDelta{ReasoningContent: "thinking"}); err != nil {
			return AIProviderCompletion{}, err
		}
		return AIProviderCompletion{FinishReason: "stop", Usage: &AIProviderUsage{PromptTokens: 1, CompletionTokens: 2, TotalTokens: 3}}, nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	if _, err := d.Handle(ctx, aiTestStart("one", "first")); err != nil {
		t.Fatal(err)
	}
	cancel()
	<-first
	events := aiTestPull(t, d, "one", "first")
	if len(events) != 1 || events[0].Sequence != 1 || events[0].Content != "first" || events[0].Type != "delta" {
		t.Fatalf("not incremental: %+v", events)
	}
	close(release)
	var rest []AIProviderEvent
	for len(rest) < 2 {
		rest = append(rest, aiTestPull(t, d, "one", "first")...)
	}
	if rest[0].Sequence != 2 || rest[0].ReasoningContent != "thinking" || rest[1].Sequence != 3 || rest[1].Type != "done" || rest[1].Usage.TotalTokens != 3 {
		t.Fatalf("invalid terminal stream: %+v", rest)
	}
	if _, err := d.Handle(context.Background(), aiTestControl("pull", "one", "first")); err == nil {
		t.Fatal("consumed terminal replayed")
	}
}

func TestAIProviderStickyEmitFailuresAndSafeErrors(t *testing.T) {
	tests := []struct {
		name, code string
		run        AIProviderGenerate
	}{
		{name: "oversize event", code: "limit_exceeded", run: func(_ context.Context, _ AIProviderStart, emit AIProviderEmit) (AIProviderCompletion, error) {
			emit(AIProviderDelta{Content: strings.Repeat("x", aiProviderMaxEventBytes)})
			return AIProviderCompletion{FinishReason: "stop"}, nil
		}},
		{name: "NUL delta", code: "generation_failed", run: func(_ context.Context, _ AIProviderStart, emit AIProviderEmit) (AIProviderCompletion, error) {
			emit(AIProviderDelta{Content: "bad\x00text"})
			return AIProviderCompletion{FinishReason: "stop"}, nil
		}},
		{name: "upstream secret", code: "generation_failed", run: func(context.Context, AIProviderStart, AIProviderEmit) (AIProviderCompletion, error) {
			return AIProviderCompletion{}, errors.New("private-api-key HTTP 503 connection reset")
		}},
		{name: "panic", code: "generation_failed", run: func(context.Context, AIProviderStart, AIProviderEmit) (AIProviderCompletion, error) {
			panic("private-api-key")
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			d := aiTestDispatcher(t, AIProviderLimits{}, test.run)
			if _, err := d.Handle(context.Background(), aiTestStart("one", "fail")); err != nil {
				t.Fatal(err)
			}
			events := aiTestPull(t, d, "one", "fail")
			if len(events) != 1 || events[0].Type != "error" || events[0].Code != test.code || events[0].Sequence != 1 {
				t.Fatalf("failure became success: %+v", events)
			}
		})
	}
}

func TestAIProviderCompletionEventBudgetReservesTerminal(t *testing.T) {
	d := aiTestDispatcher(t, AIProviderLimits{CompletionEvents: 3}, func(_ context.Context, _ AIProviderStart, emit AIProviderEmit) (AIProviderCompletion, error) {
		for i := 0; i < 5; i++ {
			emit(AIProviderDelta{Content: "part"})
		}
		return AIProviderCompletion{FinishReason: "stop"}, nil
	})
	if _, err := d.Handle(context.Background(), aiTestStart("one", "budget")); err != nil {
		t.Fatal(err)
	}
	var events []AIProviderEvent
	for len(events) < 3 {
		events = append(events, aiTestPull(t, d, "one", "budget")...)
	}
	if events[0].Sequence != 1 || events[1].Sequence != 2 || events[2].Sequence != 3 || events[2].Code != "limit_exceeded" {
		t.Fatalf("budget sequence: %+v", events)
	}
}

func TestAIProviderProviderIsolationAndUnknownCancel(t *testing.T) {
	d := aiTestDispatcher(t, AIProviderLimits{}, func(_ context.Context, start AIProviderStart, emit AIProviderEmit) (AIProviderCompletion, error) {
		if err := emit(AIProviderDelta{Content: start.ProviderID}); err != nil {
			return AIProviderCompletion{}, err
		}
		return AIProviderCompletion{FinishReason: "stop"}, nil
	})
	if _, err := d.Handle(context.Background(), aiTestControl("cancel", "one", "same")); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Handle(context.Background(), aiTestStart("one", "same")); err == nil {
		t.Fatal("late start revived canceled request")
	}
	if _, err := d.Handle(context.Background(), aiTestStart("two", "same")); err != nil {
		t.Fatal(err)
	}
	events := aiTestPull(t, d, "two", "same")
	if len(events) == 0 || events[0].Content != "two" {
		t.Fatalf("wrong provider: %+v", events)
	}
	if _, err := d.Handle(nil, aiTestStart("one", "nil")); err == nil {
		t.Fatal("nil context accepted")
	}
}
