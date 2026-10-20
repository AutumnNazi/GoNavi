package connection

import "testing"

func TestNonSQLSourceFamily(t *testing.T) {
	cases := []struct {
		dbType string
		want   string
	}{
		{"nacos", "nacos"},
		{"Redis", "redis"},
		{"milvus", "vector"},
		{"chroma", "vector"},
		{"qdrant", "vector"},
		{"mqtt", "message"},
		{"kafka", "message"},
		{"rocketmq", "message"},
		{"rabbitmq", "message"},
		{"pulsar", "message"},
		{"mysql", ""},
		{"kingbase", ""},
		{"", ""},
	}
	for _, tc := range cases {
		if got := NonSQLSourceFamily(tc.dbType); got != tc.want {
			t.Fatalf("NonSQLSourceFamily(%q) = %q, want %q", tc.dbType, got, tc.want)
		}
	}
}
