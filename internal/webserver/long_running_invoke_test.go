package webserver

import (
	"net/http"
	"net/http/httptest"
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
