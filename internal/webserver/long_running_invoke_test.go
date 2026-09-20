package webserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type writeDeadlineRecorder struct {
	http.ResponseWriter
	deadlines []time.Time
}

func (w *writeDeadlineRecorder) SetWriteDeadline(deadline time.Time) error {
	w.deadlines = append(w.deadlines, deadline)
	return nil
}

func TestClearLongRunningInvokeWriteDeadline(t *testing.T) {
	t.Parallel()

	recorder := &writeDeadlineRecorder{ResponseWriter: httptest.NewRecorder()}
	clearLongRunningInvokeWriteDeadline(recorder, "Health")
	if len(recorder.deadlines) != 0 {
		t.Fatalf("ordinary method cleared write deadline: %#v", recorder.deadlines)
	}

	clearLongRunningInvokeWriteDeadline(recorder, "DBQueryWithCancel")
	if len(recorder.deadlines) != 1 || !recorder.deadlines[0].IsZero() {
		t.Fatalf("query method write deadline = %#v, want a zero deadline", recorder.deadlines)
	}
}

func TestWrapInvokeRouteAllowsIdleThenWrite(t *testing.T) {
	const writeTimeout = 50 * time.Millisecond
	handler := wrapInvokeRoute(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(3 * writeTimeout)
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	server := httptest.NewUnstartedServer(handler)
	server.Config.WriteTimeout = writeTimeout
	server.Start()
	t.Cleanup(server.Close)

	client := &http.Client{Timeout: time.Second}
	response, err := client.Post(server.URL, "application/json", strings.NewReader(`{"method":"DBQuery"}`))
	if err != nil {
		t.Fatalf("invoke after idle past WriteTimeout: %v", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read invoke response: %v", err)
	}
	if got := string(body); got != `{"ok":true}` {
		t.Fatalf("invoke body = %q", got)
	}
}
