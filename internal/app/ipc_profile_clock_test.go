package app

import (
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
)

func TestIpcProfileRecordsExactElapsedTime(t *testing.T) {
	for _, testCase := range []struct {
		name    string
		elapsed time.Duration
		want    int64
	}{
		{name: "zero clock tick", elapsed: 0, want: 0},
		{name: "sub microsecond", elapsed: 999 * time.Nanosecond, want: 0},
		{name: "measured microseconds", elapsed: 1234 * time.Microsecond, want: 1234},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			calls := 0
			start := time.Unix(0, 0)
			now := func() time.Time {
				calls++
				if calls == 1 {
					return start
				}
				return start.Add(testCase.elapsed)
			}
			result := connection.QueryResult{Success: true, Data: map[string]any{"value": 42}, EncodeMs: 9999}
			measureQueryResultEncode(&result, now)
			if calls != 2 || result.EncodeMs != testCase.want {
				t.Fatalf("calls=%d encode=%d want=%d", calls, result.EncodeMs, testCase.want)
			}
		})
	}
}

func TestIpcProfileFailedEncodingClearsElapsedValue(t *testing.T) {
	calls := 0
	now := func() time.Time { calls++; return time.Unix(0, int64(calls)*1000000) }
	result := connection.QueryResult{Data: make(chan int), EncodeMs: 123}
	measureQueryResultEncode(&result, now)
	if calls != 2 || result.EncodeMs != 0 {
		t.Fatalf("failed encode retained timing: calls=%d encode=%d", calls, result.EncodeMs)
	}
}
