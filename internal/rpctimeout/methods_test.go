package rpctimeout

import "testing"

func TestIsLongRunningAppMethod(t *testing.T) {
	t.Parallel()

	tests := []struct {
		method string
		want   bool
	}{
		{method: "DBQueryWithCancel", want: true},
		{method: "DBQueryMulti", want: true},
		{method: "DBQueryMultiCompact", want: true},
		{method: "DBQueryMultiWithOptions", want: true},
		{method: "DBQueryMultiTransactionalWithOptions", want: true},
		{method: "ExecuteSQLFile", want: true},
		{method: "Health", want: false},
		{method: "CancelQuery", want: false},
		{method: "GenerateQueryID", want: false},
		{method: "", want: false},
	}
	for _, tt := range tests {
		if got := IsLongRunningAppMethod(tt.method); got != tt.want {
			t.Fatalf("IsLongRunningAppMethod(%q) = %v, want %v", tt.method, got, tt.want)
		}
	}
}
