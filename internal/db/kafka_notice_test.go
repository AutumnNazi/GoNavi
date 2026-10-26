package db

import "testing"

func TestKafkaPreviewTruncatedNoticeRoundTrip(t *testing.T) {
	notice := FormatKafkaPreviewTruncatedNotice(10, 64<<20)
	rows, budget, ok := ParseKafkaPreviewTruncatedNotice(notice)
	if !ok || rows != 10 || budget != 64<<20 {
		t.Fatalf("parse(%q) = (%d, %d, %v)", notice, rows, budget, ok)
	}
	for _, other := range []string{"", "SQL Server PRINT output", "gonavi:notice:other rows=1"} {
		if _, _, ok := ParseKafkaPreviewTruncatedNotice(other); ok {
			t.Fatalf("unexpected match for %q", other)
		}
	}
}
