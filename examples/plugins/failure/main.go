// Command failure deliberately violates lifecycle expectations in test packages.
// Never install these fixtures into a normal user profile.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
)

func main() {
	mode := flag.String("mode", "crash", "crash, hang, ignore-cancel, or flood")
	flag.Parse()
	// A test forgetting to reap the fixture still cannot leave it running forever.
	watchdog := time.AfterFunc(time.Minute, func() { os.Exit(124) })
	defer watchdog.Stop()
	if *mode == "hang" {
		<-time.NewTimer(time.Minute).C
		return
	}
	if err := serveFailure(*mode); err != nil {
		if _, writeErr := fmt.Fprintln(os.Stderr, "failure fixture:", err); writeErr != nil {
			os.Exit(2)
		}
		os.Exit(1)
	}
}

func serveFailure(mode string) error {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var request struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			return err
		}
		switch request.Method {
		case "plugin.initialize":
			if err := reply(encoder, request.ID, map[string]int{"apiVersion": 1}); err != nil {
				return err
			}
		case "plugin.ping":
			if err := reply(encoder, request.ID, struct{}{}); err != nil {
				return err
			}
		case "plugin.invoke":
			switch mode {
			case "crash":
				os.Exit(23)
			case "ignore-cancel": // Intentionally never reply; the reader still accepts control messages.
			case "flood":
				return flood()
			default:
				return fmt.Errorf("unknown failure mode %q", mode)
			}
		case "plugin.shutdown":
			if mode == "ignore-cancel" {
				continue
			}
			return reply(encoder, request.ID, struct{}{})
		case "$/cancelRequest": // Intentionally ignore cooperative cancellation.
		}
	}
	return scanner.Err()
}

func reply(encoder *json.Encoder, id json.RawMessage, result any) error {
	return encoder.Encode(struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
		Result  any             `json:"result"`
	}{JSONRPC: "2.0", ID: id, Result: result})
}

func flood() error {
	// Deliberately invalid, oversized stdout exercises host frame/backpressure limits.
	chunk := strings.Repeat("x", 8192)
	for i := 0; i < 512; i++ {
		if _, err := fmt.Fprint(os.Stdout, chunk); err != nil {
			return err
		}
	}
	_, err := fmt.Fprintln(os.Stdout)
	return err
}
