package app

import (
	"encoding/json"
	"os"
	"strings"
	"time"

	"GoNavi-Wails/internal/connection"
)

// ipcProfileEnabled 控制热点查询绑定的「链路分解」埋点（Q=主查询 / E=编码 / B=链路其余）。
//
// 默认开启：EncodeMs 是前端日志面板区分「SQL 慢」与「序列化慢」的唯一数据源，
// 关掉会让那一列恒为 0，反而误导排障。GONAVI_IPC_PROFILE=0 可关闭。
//
// 之所以留开关而不是常开硬编码：测量本身要对 result 再跑一次 json.Marshal
// （与 Wails 实际编码同构），这是实打实的额外 CPU 与一次全量遍历。低配机上
// 大结果集查询的收益抵不上这份开销，需要时可用环境变量整体关掉。
//
// 变量名沿用本仓库的 GONAVI_ 前缀（yxdb 参考实现用的是 YXDB_IPC_PROFILE，
// 那是它的品牌前缀，不适用于本仓库）。
var ipcProfileEnabled = strings.TrimSpace(os.Getenv("GONAVI_IPC_PROFILE")) != "0"

// ipcProfileMaxCells 重复编码测量的单元格（行×列）上限，超过则跳过 E 值测量。
//
// 这份上限保护的是低配机：测量成本与被编码的结构规模成正比，而超大结果集
// 本来就要走压缩通道（encodeCompactQueryResult 会自己量出真实编码耗时），
// 在这里再量一遍未压缩形态纯属浪费。E 保持 0，前端按「未采集」显示。
const ipcProfileMaxCells = 500000

// attachQueryTimings 把「链路分解」三段写回结果，是热点查询函数唯一的埋点出口。
//
// 三个入参的分工：
//   - queryExecutionDuration 由各查询函数在驱动调用两侧累加，是纯查询耗时；
//   - connWaitMs 由 acquireQueryConnection 累加，是取连接（含重建）等待；
//   - 编码耗时在本函数内部测量。
//
// 调用方必须把它作为**最早的** defer 注册：Go 的 defer 后进先出，先注册的最后执行，
// 这样量到编码耗时时，DurationMs 等字段（以及结果装配）都已经定稿，量到的就是
// 前端真正收到的那份结构。
//
// 抽成一个函数而不是在每个热点里各写一段：DurationMs 本来就散落在这些函数里设置，
// 再多一个同源字段若各写各的，后加的查询路径很容易只补一半。
func attachQueryTimings(result *connection.QueryResult, queryExecutionDuration time.Duration, connWaitMs int64) {
	if result == nil {
		return
	}
	result.DurationMs = durationMilliseconds(queryExecutionDuration)
	// MainQueryMs 与 DurationMs 同源：GoNavi 的 queryExecutionDuration 只包住驱动调用，
	// 本身已是「不含建连与编码」的纯查询耗时。单独留字段是为了让前端按
	// Q（主查询）/ E（编码）/ 其余（链路）三段取值时，不必复用 durationMs 的语义。
	result.MainQueryMs = result.DurationMs
	result.ConnWaitMs = connWaitMs
	profileQueryResultEncode(result)
}

// profileQueryResultEncode 测量 result 的 JSON 编码耗时（微秒）并写回 result.EncodeMs。
//
// 传入指针而不是值：EncodeMs 要落回调用方那个命名返回值，值传递会丢改动。
func profileQueryResultEncode(result *connection.QueryResult) {
	if !ipcProfileEnabled || result == nil {
		return
	}
	rows, columns := summarizeResultShape(*result)
	if !shouldMeasureEncode(rows, columns) {
		return
	}

	startedAt := time.Now()
	_, err := json.Marshal(result)
	result.EncodeMs = time.Since(startedAt).Microseconds()
	if err != nil {
		// 无法编码的结构在 Wails 侧同样会失败；绑定层不重复报错，但也谈不上
		// 「有载荷的编码耗时」，因此清 0 表示未采集，而不是报一个失败的耗时。
		result.EncodeMs = 0
	}
}

// shouldMeasureEncode 判定给定规模的结果是否值得再付一次全量 JSON 编码。
//
// 抽成纯函数是为了让上限逻辑可单测：真造一个超过 50 万单元格的结果来触发边界，
// 光测试数据就要占上百 MB，得不偿失。
func shouldMeasureEncode(rows int, columns int) bool {
	if rows <= 0 || columns <= 0 {
		// 形状未知（如影响行数这类小结构）不需要拦，照常测量。
		return true
	}
	return rows*columns <= ipcProfileMaxCells
}

// summarizeResultShape 统计结果里的行数与最大列数。
//
// 只认两种实际存在的 Data 形态：多结果集 []ResultSetData 与单结果集 []map。
// 其它形态（如 map[string]int64 的影响行数）规模恒小，返回零值即「不拦截测量」。
func summarizeResultShape(result connection.QueryResult) (rows int, columns int) {
	switch data := result.Data.(type) {
	case []connection.ResultSetData:
		for index := range data {
			rows += len(data[index].Rows)
			if count := len(data[index].Columns); count > columns {
				columns = count
			}
		}
	case []map[string]interface{}:
		rows = len(data)
		if len(data) > 0 {
			columns = len(data[0])
		}
	}
	return rows, columns
}
