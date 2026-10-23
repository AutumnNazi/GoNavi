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

func installExporterFixture(t *testing.T, manager *Manager, mode string, requirements ...Dependency) Status {
	t.Helper()
	manifest := exporterManifest()
	manifest.Requires = requirements
	other := manifest.Contributes.Exporters[0]
	other.ID = "second"
	manifest.Contributes.Exporters = append(manifest.Contributes.Exporters, other)
	if runtime.GOOS == "windows" {
		manifest.Backend.Default.Executable += ".exe"
	}
	manifest.Backend.Default.Args = []string{"-test.run=^TestExporterProcess$", "--", "--exporter-runtime-fixture", mode}
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
		t.Fatalf("copy exporter fixture: %v %v %v", copyErr, inErr, outErr)
	}
	return installSource(t, manager, directory)
}

func TestExporterProcess(t *testing.T) {
	mode := ""
	for index, arg := range os.Args {
		if arg == "--exporter-runtime-fixture" && index+1 < len(os.Args) {
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
			os.Exit(81)
		}
	}
	for scanner.Scan() {
		var request struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if json.Unmarshal(scanner.Bytes(), &request) != nil {
			os.Exit(82)
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
				Command   string          `json:"commandId"`
				Arguments json.RawMessage `json:"arguments"`
			}
			if json.Unmarshal(request.Params, &params) != nil {
				os.Exit(83)
			}
			if params.Command == "ordinary" {
				respond(request.ID, params.Arguments)
				continue
			}
			if mode == "hold" {
				continue
			}
			if mode == "delay" {
				timer := time.NewTimer(75 * time.Millisecond)
				<-timer.C
				timer.Stop()
			}
			var args struct {
				Rows []json.RawMessage `json:"rows"`
			}
			if json.Unmarshal(params.Arguments, &args) != nil {
				os.Exit(84)
			}
			text := "fixture\n"
			if len(args.Rows) == 0 {
				text = ""
			}
			if mode == "oversize" {
				text = strings.Repeat("x", maxExporterJSONBytes+2048)
			}
			respond(request.ID, map[string]any{"protocolVersion": 1, "rowCount": len(args.Rows), "text": text})
		}
	}
	os.Exit(0)
}
