package dataexport

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"testing"
)

type failingParquetOutput struct {
	bytes.Buffer
	remaining int
	failure   error
	cancel    context.CancelFunc
}

func (w *failingParquetOutput) Write(payload []byte) (int, error) {
	if w.cancel != nil {
		w.cancel()
	}
	if len(payload) > w.remaining {
		return 0, w.failure
	}
	w.remaining -= len(payload)
	return w.Buffer.Write(payload)
}

func TestParquetFinalizationFailureAndCancellation(t *testing.T) {
	failure := errors.New("output failed")
	for _, tc := range []struct {
		name   string
		limit  int
		cancel bool
		empty  bool
	}{
		{"header", 0, false, false}, {"footer", 4, false, true},
		{"column", 8, false, false}, {"cancel during output", 100000, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			output := &failingParquetOutput{remaining: tc.limit, failure: failure}
			if tc.cancel {
				output.cancel = cancel
			}
			var path string
			factory := func() (*TempFile, error) {
				spool, err := newParquetTempFile()
				if err == nil {
					path = spool.Reader.(*os.File).Name()
				}
				return spool, err
			}
			writer := NewParquet(ctx, output, factory)
			if err := writer.SetColumns([]string{"v"}); err != nil {
				t.Fatal(err)
			}
			if !tc.empty {
				for i := 0; i < 1025; i++ {
					if err := writer.ConsumeRowValues([]any{i}); err != nil {
						t.Fatal(err)
					}
				}
			}
			err := writer.Close()
			want := failure
			if tc.cancel {
				want = context.Canceled
			}
			if !errors.Is(err, want) {
				t.Fatalf("lost %v: %v", want, err)
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatal("temporary file leaked")
			}
		})
	}
	writer := NewParquet(context.Background(), shortOutput{}, nil)
	if err := writer.SetColumns([]string{"v"}); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("short output: %v", err)
	}
}
