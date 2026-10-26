//go:build gonavi_full_drivers || gonavi_kafka_driver

package db

import (
	"context"
	"errors"
	"fmt"
	"testing"

	kafka "github.com/segmentio/kafka-go"
)

func TestRetryOnKafkaLeaderChange(t *testing.T) {
	// e2e：broker 重启后前几次预览报 NotLeaderForPartition，刷新元数据后重试即可读到。
	stale := fmt.Errorf("读取 Kafka orders[0] offset 失败：%w", kafka.NotLeaderForPartition)
	for _, tc := range []struct {
		name         string
		errs         []error
		wantErr      error
		wantCalls    int
		wantRefresh  int
		cancelBefore bool
	}{
		{name: "leader moved, retry succeeds", errs: []error{stale, nil}, wantCalls: 2, wantRefresh: 1},
		{name: "leader still moving, gives up after one retry", errs: []error{stale, stale}, wantErr: kafka.NotLeaderForPartition, wantCalls: 2, wantRefresh: 1},
		{name: "other errors are not retried", errs: []error{kafka.TopicAuthorizationFailed}, wantErr: kafka.TopicAuthorizationFailed, wantCalls: 1},
		{name: "canceled context is not retried", errs: []error{stale}, wantErr: kafka.NotLeaderForPartition, wantCalls: 1, cancelBefore: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if tc.cancelBefore {
				cancel()
			}
			calls, refreshes := 0, 0
			got, err := retryOnKafkaLeaderChange(ctx, func() { refreshes++ }, func() (int, error) {
				err := tc.errs[calls]
				calls++
				return calls, err
			})
			if !errors.Is(err, tc.wantErr) || (tc.wantErr == nil && err != nil) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if calls != tc.wantCalls || refreshes != tc.wantRefresh {
				t.Fatalf("calls=%d refreshes=%d, want %d/%d", calls, refreshes, tc.wantCalls, tc.wantRefresh)
			}
			if err == nil && got != calls {
				t.Fatalf("result = %d, want the retried read's result", got)
			}
		})
	}
}
