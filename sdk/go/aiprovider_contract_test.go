package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
)

func TestAIProviderRequestToolDefinitions128And129(t *testing.T) {
	for _, count := range []int{65, 128, 129} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			d := aiTestDispatcher(t, AIProviderLimits{}, func(context.Context, AIProviderStart, AIProviderEmit) (AIProviderCompletion, error) {
				return AIProviderCompletion{FinishReason: "stop"}, nil
			})
			var request map[string]any
			if err := json.Unmarshal(aiTestStart("one", "tools"), &request); err != nil {
				t.Fatal(err)
			}
			definitions := make([]AIProviderTool, count)
			for index := range definitions {
				definitions[index] = AIProviderTool{Type: "function", Function: AIProviderToolFunction{Name: fmt.Sprint("tool-", index), Parameters: json.RawMessage(`{"type":"object"}`)}}
			}
			request["request"].(map[string]any)["tools"] = definitions
			raw, err := json.Marshal(request)
			if err != nil {
				t.Fatal(err)
			}
			_, err = d.Handle(context.Background(), raw)
			if (err == nil) != (count <= 128) {
				t.Fatalf("tool definitions %d: %v", count, err)
			}
		})
	}
}

func TestAIProviderConstructCancelAndAbortAreRaceSafe(t *testing.T) {
	registration := AIProviderRegistration{Models: []AIModel{{ID: "model", Name: "Model", ContextWindow: 1024, MaxOutputTokens: 64}}, Generate: func(context.Context, AIProviderStart, AIProviderEmit) (AIProviderCompletion, error) {
		return AIProviderCompletion{FinishReason: "stop"}, nil
	}}
	for index := 0; index < 300; index++ {
		root, cancel := context.WithCancel(context.Background())
		var canceled sync.WaitGroup
		canceled.Add(1)
		go func() { defer canceled.Done(); cancel() }()
		dispatcher, err := NewAIProviderDispatcher(root, AIProviderOptions{Providers: map[string]AIProviderRegistration{"provider": registration}})
		canceled.Wait()
		if err != nil {
			if root.Err() == nil {
				t.Fatal(err)
			}
			continue
		}
		var aborted sync.WaitGroup
		for repeat := 0; repeat < 3; repeat++ {
			aborted.Add(1)
			go func() { defer aborted.Done(); dispatcher.Abort() }()
		}
		aborted.Wait()
		if err = dispatcher.Close(context.Background()); err != nil {
			t.Fatal(err)
		}
		if err = dispatcher.Close(nil); err == nil {
			t.Fatal("nil Close context accepted")
		}
	}
}
