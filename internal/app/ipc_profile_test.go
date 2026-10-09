package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
)

// TestIpcProfileWritesQueryTimings 锁定「链路分解」三段写入的语义。
//
// Q（主查询）与 durationMs 同源、E（编码）走独立测量、B（其余）由前端用总耗时相减得到，
// 所以这里必须保证 MainQueryMs == DurationMs 且 ConnWaitMs 原样落值 —— 一旦有人把
// MainQueryMs 改成别的口径，前端算出的 B 段就会悄悄漂移，而 UI 上看不出异常。
func TestIpcProfileWritesQueryTimings(t *testing.T) {
	t.Parallel()

	rows := make([]map[string]interface{}, 500)
	for index := range rows {
		rows[index] = map[string]interface{}{"id": index, "name": "value", "flag": true}
	}
	result := connection.QueryResult{
		Success: true,
		Data:    []connection.ResultSetData{{Columns: []string{"id", "name", "flag"}, Rows: rows}},
	}

	attachQueryTimings(&result, 250*time.Millisecond, 42)

	if result.DurationMs != 250 {
		t.Fatalf("DurationMs = %d, want 250", result.DurationMs)
	}
	if result.MainQueryMs != result.DurationMs {
		t.Fatalf("MainQueryMs = %d, want 与 DurationMs 同源(%d)", result.MainQueryMs, result.DurationMs)
	}
	if result.ConnWaitMs != 42 {
		t.Fatalf("ConnWaitMs = %d, want 42", result.ConnWaitMs)
	}
	if result.EncodeMs <= 0 {
		t.Fatalf("EncodeMs = %d, want > 0（500 行结果的 JSON 编码不可能真的 0 微秒）", result.EncodeMs)
	}
}

// TestIpcProfileSkipsOversizedResult 保证超大结果不再多付一次全量编码。
//
// 用纯函数 shouldMeasureEncode 直接打边界，而不是真造 50 万单元格的测试数据
// （那要占上百 MB 内存，且测的还是分配器）。
func TestIpcProfileSkipsOversizedResult(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		rows    int
		columns int
		want    bool
	}{
		{name: "典型小结果测量", rows: 500, columns: 20, want: true},
		{name: "恰好在阈值上仍测量", rows: 5000, columns: 100, want: true},
		{name: "超过一个单元格即跳过", rows: 5000, columns: 101, want: false},
		{name: "形状未知照常测量", rows: 0, columns: 0, want: true},
		{name: "只有列没有行照常测量", rows: 0, columns: 10, want: true},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			if got := shouldMeasureEncode(testCase.rows, testCase.columns); got != testCase.want {
				t.Fatalf("shouldMeasureEncode(%d, %d) = %v, want %v", testCase.rows, testCase.columns, got, testCase.want)
			}
		})
	}
}

// TestIpcProfileSkipsWhenDisabled 保证开关真能关掉测量：关掉后 EncodeMs 必须保持 0，
// 否则前端会看到一个「有值但没意义」的编码耗时，比没有更误导。
func TestIpcProfileSkipsWhenDisabled(t *testing.T) {
	original := ipcProfileEnabled
	t.Cleanup(func() { ipcProfileEnabled = original })
	ipcProfileEnabled = false

	result := connection.QueryResult{Success: true, Data: []map[string]interface{}{{"id": 1}}}
	attachQueryTimings(&result, 10*time.Millisecond, 5)

	if result.EncodeMs != 0 {
		t.Fatalf("关闭埋点后 EncodeMs = %d, want 0", result.EncodeMs)
	}
	// 另外两段来自已有计时，与埋点开关无关，必须照常落值。
	if result.DurationMs != 10 || result.MainQueryMs != 10 || result.ConnWaitMs != 5 {
		t.Fatalf("关闭埋点不应影响其它耗时字段：%+v", result)
	}
}

// TestIpcProfileTimingsUseOmitempty 锁定 JSON 兼容性：三段都带 omitempty，
// 未采集的零值不得出现在线格式上，避免给前端和 MCP 消费者塞入无意义字段。
func TestIpcProfileTimingsUseOmitempty(t *testing.T) {
	t.Parallel()

	empty, err := json.Marshal(connection.QueryResult{Success: true})
	if err != nil {
		t.Fatalf("marshal 空结果失败：%v", err)
	}
	for _, key := range []string{"mainQueryMs", "connWaitMs", "encodeMs"} {
		if strings.Contains(string(empty), `"`+key+`"`) {
			t.Fatalf("零值不应出现 %s：%s", key, empty)
		}
	}

	filled, err := json.Marshal(connection.QueryResult{
		Success:     true,
		DurationMs:  7,
		MainQueryMs: 7,
		ConnWaitMs:  3,
		EncodeMs:    1200,
	})
	if err != nil {
		t.Fatalf("marshal 带耗时结果失败：%v", err)
	}
	for _, fragment := range []string{`"mainQueryMs":7`, `"connWaitMs":3`, `"encodeMs":1200`} {
		if !strings.Contains(string(filled), fragment) {
			t.Fatalf("线格式缺少 %s：%s", fragment, filled)
		}
	}
}

// TestIpcProfileCompactTransportOverwritesEncodeCost 锁定压缩通道的 E 值口径。
//
// 压缩通道上真正过桥的是 gzip + base64 载荷，不是未压缩的行键展开 JSON：
// attachQueryTimings 先量到的那个值口径不对（它量的是未压缩结构），必须由
// encodeCompactQueryResult 覆盖。覆盖不生效时前端会拿错误的 E 去算 B 段。
//
// 注意不要断言「压缩后的耗时更小」：gzip 本身可能比一次纯 marshal 更贵（本例实测
// 约 9ms vs 8ms），E 的语义是「真实编码成本」，不是「必须更小」。这里用哨兵值
// 证明覆盖动作发生了。
func TestIpcProfileCompactTransportOverwritesEncodeCost(t *testing.T) {
	t.Parallel()

	rows := make([]map[string]interface{}, 500)
	for index := range rows {
		rows[index] = map[string]interface{}{"id": index, "name": strings.Repeat("repeated-value-", 40)}
	}
	// 哨兵：一个足够大、不可能由真实测量得出的值，用来证明字段被重写过。
	const staleEncodeMs = 999999999
	result := connection.QueryResult{
		Success:     true,
		DurationMs:  100,
		MainQueryMs: 100,
		ConnWaitMs:  4,
		EncodeMs:    staleEncodeMs,
		Data:        []connection.ResultSetData{{Columns: []string{"id", "name"}, Rows: rows}},
	}

	compact := encodeCompactQueryResult(result)
	if compact.DataEncoding != compactQueryResultEncoding {
		t.Fatalf("期望压缩通道，实际 dataEncoding=%q", compact.DataEncoding)
	}
	if compact.EncodeMs == staleEncodeMs {
		t.Fatalf("EncodeMs 仍是压缩前的值(%d)，覆盖没生效", staleEncodeMs)
	}
	if compact.EncodeMs <= 0 {
		t.Fatalf("EncodeMs = %d, want > 0", compact.EncodeMs)
	}
	// 三段里的另两段必须原样带过压缩边界。
	if compact.DurationMs != 100 || compact.MainQueryMs != 100 || compact.ConnWaitMs != 4 {
		t.Fatalf("压缩不应改动其它耗时字段：%+v", compact.QueryResult)
	}
}
