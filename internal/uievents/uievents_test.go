package uievents

import (
	"context"
	"testing"
)

type recordingEmitter struct {
	names []string
}

func (r *recordingEmitter) Emit(name string, _ ...any) {
	r.names = append(r.names, name)
}

func TestEmitSkipsContextsWithoutEventBus(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		ctx     context.Context
		canEmit bool
	}{
		{name: "nil context", ctx: nil, canEmit: false},
		{name: "plain context", ctx: context.Background(), canEmit: false},
		{name: "cancelled plain context", ctx: func() context.Context {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			return ctx
		}(), canEmit: false},
		{name: "wails-like context", ctx: context.WithValue(context.Background(), wailsEventsContextKey, struct{}{}), canEmit: true},
		{name: "injected emitter", ctx: WithEmitter(context.Background(), &recordingEmitter{}), canEmit: true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := CanEmit(tt.ctx); got != tt.canEmit {
				t.Fatalf("CanEmit() = %v, want %v", got, tt.canEmit)
			}
			if !tt.canEmit {
				// Must return instead of reaching the Wails runtime, which would log.Fatal.
				Emit(tt.ctx, "query:progress", map[string]any{"queryId": "q1"})
			}
		})
	}
}

func TestEmitPrefersInjectedEmitter(t *testing.T) {
	t.Parallel()

	recorder := &recordingEmitter{}
	ctx := WithEmitter(context.WithValue(context.Background(), wailsEventsContextKey, struct{}{}), recorder)
	Emit(ctx, "first")
	Emit(ctx, "second", 1, "two")
	if len(recorder.names) != 2 || recorder.names[0] != "first" || recorder.names[1] != "second" {
		t.Fatalf("unexpected emitted names: %v", recorder.names)
	}
	if WithEmitter(nil, nil) == nil {
		t.Fatal("WithEmitter(nil, nil) should return a usable context")
	}
}
