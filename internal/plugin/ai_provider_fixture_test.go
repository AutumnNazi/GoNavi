package plugin

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func installAIProviderFixture(t *testing.T, m *Manager, mode string, requirements ...Dependency) Status {
	t.Helper()
	manifest := aiProviderManifest()
	manifest.Requires = append([]Dependency(nil), requirements...)
	other := manifest.Contributes.AIProviders[0]
	other.ID = "second"
	manifest.Contributes.AIProviders = append(manifest.Contributes.AIProviders, other)
	if runtime.GOOS == "windows" {
		manifest.Backend.Default.Executable += ".exe"
	}
	manifest.Backend.Default.Args = []string{"-test.run=^TestAIProviderProcess$", "--", "--ai-provider-fixture", mode}
	directory := writePackage(t, manifest)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	input, err := os.Open(executable)
	if err != nil {
		t.Fatal(err)
	}
	output, err := os.Create(filepath.Join(directory, manifest.Backend.Default.Executable))
	if err != nil {
		input.Close()
		t.Fatal(err)
	}
	_, copyErr := io.Copy(output, input)
	inErr := input.Close()
	outErr := output.Close()
	if copyErr != nil || inErr != nil || outErr != nil {
		t.Fatalf("copy fixture: %v %v %v", copyErr, inErr, outErr)
	}
	return installSource(t, m, directory)
}

func TestAIProviderProcess(t *testing.T) {
	mode := ""
	for index, arg := range os.Args {
		if arg == "--ai-provider-fixture" && index+1 < len(os.Args) {
			mode = os.Args[index+1]
		}
	}
	if mode == "" {
		return
	}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), maxRPCBytes+1)
	encoder := json.NewEncoder(os.Stdout)
	respond := func(id json.RawMessage, value any) {
		if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": value}); err != nil {
			os.Exit(71)
		}
	}
	var held []json.RawMessage
	for scanner.Scan() {
		var request struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			os.Exit(72)
		}
		switch request.Method {
		case "plugin.initialize":
			respond(request.ID, map[string]int{"apiVersion": 1})
		case "plugin.ping":
			respond(request.ID, struct{}{})
		case "plugin.shutdown":
			respond(request.ID, struct{}{})
			os.Exit(0)
		case "plugin.invoke":
			var params struct {
				Command string          `json:"commandId"`
				Args    json.RawMessage `json:"arguments"`
			}
			if json.Unmarshal(request.Params, &params) != nil {
				os.Exit(73)
			}
			if params.Command == "ordinary" {
				respond(request.ID, params.Args)
				continue
			}
			var header struct {
				Operation string `json:"operation"`
			}
			if json.Unmarshal(params.Args, &header) != nil {
				os.Exit(74)
			}
			switch header.Operation {
			case "start":
				respond(request.ID, map[string]bool{"accepted": true})
			case "pull":
				if mode == "hold" || mode == "late-oversize" {
					held = append(held, append(json.RawMessage(nil), request.ID...))
					continue
				}
				if mode == "delay" {
					timer := time.NewTimer(75 * time.Millisecond)
					<-timer.C
					timer.Stop()
				}
				if mode == "large" {
					respond(request.ID, map[string]any{"events": []any{}, "padding": strings.Repeat("x", (128<<10)-256)})
				} else {
					respond(request.ID, map[string]any{"events": []any{}})
				}
			case "cancel":
				respond(request.ID, map[string]bool{"ok": true})
				for _, id := range held {
					if mode == "late-oversize" {
						respond(id, strings.Repeat("x", aiPullReplyBytes+1))
					} else {
						respond(id, map[string]any{"events": []any{}})
					}
				}
				held = nil
			default:
				os.Exit(75)
			}
		}
	}
	os.Exit(0)
}
