package provider

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"GoNavi-Wails/internal/ai"
)

const grokTestImage = "data:image/png;base64,aGVsbG8="

// Exercise the provider boundary and the child process reading the file, not
// just the converter: screenshots must reach Grok as images rather than text.
func TestGrokCLIProviderTransmitsImages(t *testing.T) {
	largeData := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("pixels", 30_000)))
	tests := []struct {
		name     string
		messages []ai.Message
	}{
		{name: "screenshot", messages: []ai.Message{{Role: "user", Content: "Describe this screenshot", Images: []string{grokTestImage}}}},
		{name: "image only", messages: []ai.Message{{Role: "user", Images: []string{grokTestImage}}}},
		{name: "multiple images with history", messages: []ai.Message{
			{Role: "system", Content: "Answer about the database"},
			{Role: "assistant", Content: "Upload the screenshots"},
			{Role: "user", Content: "Compare these", Images: []string{grokTestImage, "data:image/jpeg;base64,d29ybGQ="}},
		}},
		{name: "large payload", messages: []ai.Message{{Role: "user", Content: strings.Repeat("question ", 10_000), Images: []string{"data:image/png;base64," + largeData}}}},
	}
	for _, test := range tests {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream=%v", test.name, stream), func(t *testing.T) {
				capture := captureGrokImageCommand(t, "success", nil)
				runGrokImageRequest(t, test.messages, stream, false)
				if filepath.Ext(capture.path) != ".json" {
					t.Fatalf("image prompt must use .json, got %q", capture.path)
				}
				var blocks []struct {
					Type     string `json:"type"`
					Text     string `json:"text"`
					Data     string `json:"data"`
					MIMEType string `json:"mimeType"`
				}
				if err := json.Unmarshal(capture.payload, &blocks); err != nil {
					t.Fatalf("image input is not ACP JSON: %v", err)
				}
				var texts, images []string
				for _, block := range blocks {
					switch block.Type {
					case "text":
						texts = append(texts, block.Text)
					case "image":
						images = append(images, "data:"+block.MIMEType+";base64,"+block.Data)
					default:
						t.Fatalf("unexpected content block: %s", block.Type)
					}
				}
				if strings.Join(texts, "") != buildPrompt(test.messages) {
					t.Fatal("text/history was changed")
				}
				var wantImages []string
				for _, message := range test.messages {
					wantImages = append(wantImages, message.Images...)
				}
				if !reflect.DeepEqual(images, wantImages) {
					t.Fatal("image bytes, MIME type, or ordering changed")
				}
				argv := strings.Join(capture.args, " ")
				if strings.Contains(argv, "aGVsbG8=") || strings.Contains(argv, largeData) || strings.Contains(argv, "Describe this screenshot") {
					t.Fatal("image or prompt payload leaked into argv")
				}
				for _, required := range []string{"--disallowed-tools", grokCLIDisallowedTools, "--system-prompt-override", grokCLISystemPrompt, "--disable-web-search", "--no-subagents"} {
					if !strings.Contains(argv, required) {
						t.Fatalf("missing isolation setting %q", required)
					}
				}
				assertGrokPromptRemoved(t, capture.path)
			})
		}
	}
}

type grokImageCommandCapture struct {
	args    []string
	path    string
	payload []byte
}

func captureGrokImageCommand(t *testing.T, mode string, cancel context.CancelFunc) *grokImageCommandCapture {
	t.Helper()
	originalLookPath, originalCommand := grokLookPath, grokCommandContext
	t.Cleanup(func() { grokLookPath, grokCommandContext = originalLookPath, originalCommand })
	t.Setenv("GROK_HOME", t.TempDir())
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	grokLookPath = func(string) (string, error) { return executable, nil }
	capture := &grokImageCommandCapture{}
	grokCommandContext = func(ctx context.Context, _ string, args ...string) *exec.Cmd {
		capture.args = append([]string(nil), args...)
		for i, arg := range args {
			if arg == "--prompt-file" && i+1 < len(args) {
				capture.path = args[i+1]
			}
		}
		payload, err := os.ReadFile(capture.path)
		if err != nil {
			t.Fatalf("read prompt: %v", err)
		}
		capture.payload = payload
		info, err := os.Stat(capture.path)
		if err != nil {
			t.Fatal(err)
		}
		if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
			t.Fatalf("prompt permissions = %o", info.Mode().Perm())
		}
		cmd := exec.CommandContext(ctx, executable, "-test.run=^TestGrokCLIImageHelperProcess$", "--")
		cmd.Env = append(os.Environ(), "GO_WANT_GROK_IMAGE_HELPER=1", "GO_GROK_IMAGE_PROMPT="+capture.path, "GO_GROK_IMAGE_MODE="+mode)
		if cancel != nil {
			cancel()
		}
		return cmd
	}
	return capture
}

func runGrokImageRequest(t *testing.T, messages []ai.Message, stream, wantError bool) {
	t.Helper()
	provider, err := NewGrokCLIProvider(ai.ProviderConfig{AuthMode: "local-cli"})
	if err != nil {
		t.Fatal(err)
	}
	req := ai.ChatRequest{Messages: messages}
	if stream {
		var streamError string
		err = provider.ChatStream(context.Background(), req, func(chunk ai.StreamChunk) { streamError += chunk.Error })
		if (err != nil || streamError != "") != wantError {
			t.Fatalf("stream err=%v, error chunk=%q, want error=%v", err, streamError, wantError)
		}
	} else {
		_, err = provider.Chat(context.Background(), req)
		if (err != nil) != wantError {
			t.Fatalf("chat err=%v, want error=%v", err, wantError)
		}
	}
}

func assertGrokPromptRemoved(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("temporary prompt was not removed: %v", err)
	}
}

func TestGrokCLIImageHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_GROK_IMAGE_HELPER") != "1" {
		return
	}
	payload, err := os.ReadFile(os.Getenv("GO_GROK_IMAGE_PROMPT"))
	if err != nil {
		os.Exit(2)
	}
	if os.Getenv("GO_GROK_IMAGE_MODE") == "failure" {
		os.Exit(1)
	}
	if filepath.Ext(os.Getenv("GO_GROK_IMAGE_PROMPT")) == ".json" {
		var blocks []struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			Data     string `json:"data"`
			MIMEType string `json:"mimeType"`
		}
		if json.Unmarshal(payload, &blocks) != nil || len(blocks) == 0 {
			os.Exit(3)
		}
	}
	if err := json.NewEncoder(os.Stdout).Encode(map[string]string{"text": "image received", "stopReason": "end_turn"}); err != nil {
		os.Exit(4)
	}
	os.Exit(0)
}

func TestGrokCLIImagePromptCleanupOnFailure(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%v", stream), func(t *testing.T) {
			capture := captureGrokImageCommand(t, "failure", nil)
			runGrokImageRequest(t, []ai.Message{{Role: "user", Images: []string{grokTestImage}}}, stream, true)
			assertGrokPromptRemoved(t, capture.path)
		})
	}
}

func TestGrokCLIImagePromptCleanupOnCancel(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%v", stream), func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			capture := captureGrokImageCommand(t, "success", cancel)
			provider, err := NewGrokCLIProvider(ai.ProviderConfig{AuthMode: "local-cli"})
			if err != nil {
				t.Fatal(err)
			}
			req := ai.ChatRequest{Messages: []ai.Message{{Role: "user", Images: []string{grokTestImage}}}}
			if stream {
				err = provider.ChatStream(ctx, req, func(ai.StreamChunk) {})
			} else {
				_, err = provider.Chat(ctx, req)
			}
			if err == nil {
				t.Fatal("cancelled image request succeeded")
			}
			assertGrokPromptRemoved(t, capture.path)
		})
	}
}

func TestGrokCLITextPromptStaysPlain(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%v", stream), func(t *testing.T) {
			capture := captureGrokImageCommand(t, "success", nil)
			// Even JSON-looking user text must not accidentally become ACP input.
			text := "[{\"type\":\"image\"}]"
			runGrokImageRequest(t, []ai.Message{{Role: "user", Content: text}}, stream, false)
			if filepath.Ext(capture.path) != ".txt" || string(capture.payload) != text {
				t.Fatal("plain text path changed")
			}
			assertGrokPromptRemoved(t, capture.path)
		})
	}
}

func TestGrokCLIProviderRejectsInvalidImageBeforeLaunching(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%v", stream), func(t *testing.T) {
			capture := captureGrokImageCommand(t, "success", nil)
			runGrokImageRequest(t, []ai.Message{{Role: "user", Content: "Do not silently drop this image", Images: []string{"data:image/png;base64,invalid!"}}}, stream, true)
			if capture.path != "" {
				t.Fatal("invalid image reached the CLI")
			}
		})
	}
}

func TestBuildGrokCLIContentBlocksRejectsInvalidImages(t *testing.T) {
	for _, image := range []string{"", "data:image/png", "data:image/png;base64,", "data:text/plain;base64,aGVsbG8=", "data:image/png;base64,not!base64", "https://example.invalid/image.png"} {
		t.Run(image, func(t *testing.T) {
			_, err := buildGrokCLIContentBlocks([]ai.Message{{Role: "user", Images: []string{image}}})
			if err == nil {
				t.Fatal("invalid image was silently accepted")
			}
		})
	}
}
