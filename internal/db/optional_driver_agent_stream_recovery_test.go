package db

import (
	"bufio"
	"errors"
	"strconv"
	"strings"
	"testing"
)

// errStreamConsumerCanceled 模拟导出/前端取消等消费端主动中断。
var errStreamConsumerCanceled = errors.New("consumer canceled")

func streamTestFrameID(id int64) string {
	return strconv.FormatInt(id, 10)
}

// streamTestCancelingConsumer 在第 consumeLimit 行后返回取消错误。
type streamTestCancelingConsumer struct {
	columns       []string
	rows          [][]interface{}
	consumeLimit  int
	consumeCalled int
}

func (c *streamTestCancelingConsumer) SetColumns(columns []string) error {
	c.columns = append([]string(nil), columns...)
	return nil
}

func (c *streamTestCancelingConsumer) ConsumeRow(row map[string]interface{}) error {
	c.consumeCalled++
	if c.consumeCalled > c.consumeLimit {
		return errStreamConsumerCanceled
	}
	values := make([]interface{}, len(c.columns))
	for idx, column := range c.columns {
		values[idx] = row[column]
	}
	c.rows = append(c.rows, values)
	return nil
}

// streamTestFailingSetColumns 模拟列设置阶段失败（如导出器初始化失败）。
type streamTestFailingSetColumns struct {
	columns []string
}

func (c *streamTestFailingSetColumns) SetColumns(columns []string) error {
	return errStreamConsumerCanceled
}

func (c *streamTestFailingSetColumns) ConsumeRow(row map[string]interface{}) error {
	return errStreamConsumerCanceled
}

func streamTestRequestFrames(id int64, rowsData string) []string {
	return []string{
		`{"id":` + streamTestFrameID(id) + `,"success":true,"chunkType":"columns","fields":["id","name"]}`,
		`{"id":` + streamTestFrameID(id) + `,"success":true,"chunkType":"rows","data":` + rowsData + `}`,
	}
}

func streamTestDoneFrame(id int64) string {
	return `{"id":` + streamTestFrameID(id) + `,"success":true,"chunkType":"done"}`
}

func TestOptionalDriverAgentClientStreamDrainsResidueAfterConsumeRowError(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	// 请求 1 中途取消后，agent 仍会写完剩余行 + done；随后串行处理请求 2。
	stdout := strings.Join([]string{
		streamTestRequestFrames(1, `[[1,"alice"],[2,"bob"]]`)[0],
		streamTestRequestFrames(1, `[[1,"alice"],[2,"bob"]]`)[1],
		`{"id":1,"success":true,"chunkType":"rows","data":[[3,"carol"]]}`,
		streamTestDoneFrame(1),
		streamTestRequestFrames(2, `[[9,"dave"]]`)[0],
		streamTestRequestFrames(2, `[[9,"dave"]]`)[1],
		streamTestDoneFrame(2),
	}, "\n") + "\n"

	client := &optionalDriverAgentClient{
		stdin:  &stdin,
		reader: bufio.NewReader(strings.NewReader(stdout)),
		driver: "oceanbase",
	}
	consumer := &streamTestCancelingConsumer{consumeLimit: 0}
	err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 1",
	}, consumer)
	if !errors.Is(err, errStreamConsumerCanceled) {
		t.Fatalf("应返回消费端原始错误，got %v", err)
	}
	if len(consumer.rows) != 0 || consumer.consumeCalled != 1 {
		t.Fatalf("取消前应只处理第 1 行: rows=%d called=%d", len(consumer.rows), consumer.consumeCalled)
	}

	// 排空后 transport 仍可用，且请求 2 读到的是自己的帧而不是请求 1 的残留行。
	next := &optionalAgentTestStreamConsumer{}
	if err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 2",
	}, next); err != nil {
		t.Fatalf("排空后下一个请求应正常完成: %v", err)
	}
	if len(next.rows) != 1 || next.rows[0][0] != int64(9) {
		t.Fatalf("下一个请求读到残留帧或数据异常: %#v", next.rows)
	}
	if strings.Join(next.columns, ",") != "id,name" {
		t.Fatalf("下一个请求列信息异常: %#v", next.columns)
	}
}

func TestOptionalDriverAgentClientStreamDrainsAfterSetColumnsError(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	stdout := strings.Join([]string{
		streamTestRequestFrames(1, `[[1,"alice"]]`)[0],
		streamTestRequestFrames(1, `[[1,"alice"]]`)[1],
		streamTestDoneFrame(1),
		streamTestRequestFrames(2, `[[9,"dave"]]`)[0],
		streamTestRequestFrames(2, `[[9,"dave"]]`)[1],
		streamTestDoneFrame(2),
	}, "\n") + "\n"

	client := &optionalDriverAgentClient{
		stdin:  &stdin,
		reader: bufio.NewReader(strings.NewReader(stdout)),
		driver: "oceanbase",
	}
	err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 1",
	}, &streamTestFailingSetColumns{})
	if !errors.Is(err, errStreamConsumerCanceled) {
		t.Fatalf("应返回消费端原始错误，got %v", err)
	}

	next := &optionalAgentTestStreamConsumer{}
	if err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 2",
	}, next); err != nil {
		t.Fatalf("排空后下一个请求应正常完成: %v", err)
	}
	if len(next.rows) != 1 || next.rows[0][0] != int64(9) {
		t.Fatalf("下一个请求读到残留帧或数据异常: %#v", next.rows)
	}
}

func TestOptionalDriverAgentClientStreamDrainsAfterRowDecodeError(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	stdout := strings.Join([]string{
		streamTestRequestFrames(1, `"not-an-array"`)[0],
		streamTestRequestFrames(1, `"not-an-array"`)[1],
		streamTestDoneFrame(1),
		streamTestRequestFrames(2, `[[9,"dave"]]`)[0],
		streamTestRequestFrames(2, `[[9,"dave"]]`)[1],
		streamTestDoneFrame(2),
	}, "\n") + "\n"

	client := &optionalDriverAgentClient{
		stdin:  &stdin,
		reader: bufio.NewReader(strings.NewReader(stdout)),
		driver: "oceanbase",
	}
	err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 1",
	}, &optionalAgentTestStreamConsumer{})
	if err == nil || !strings.Contains(err.Error(), "解析") {
		t.Fatalf("应返回行解码错误，got %v", err)
	}

	next := &optionalAgentTestStreamConsumer{}
	if err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 2",
	}, next); err != nil {
		t.Fatalf("排空后下一个请求应正常完成: %v", err)
	}
	if len(next.rows) != 1 || next.rows[0][0] != int64(9) {
		t.Fatalf("下一个请求读到残留帧或数据异常: %#v", next.rows)
	}
}

func TestOptionalDriverAgentClientStreamDrainsUnknownChunkType(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	stdout := strings.Join([]string{
		streamTestRequestFrames(1, `[[1,"alice"]]`)[0],
		`{"id":1,"success":true,"chunkType":"progress","data":null}`,
		streamTestRequestFrames(1, `[[1,"alice"]]`)[1],
		streamTestDoneFrame(1),
		streamTestRequestFrames(2, `[[9,"dave"]]`)[0],
		streamTestRequestFrames(2, `[[9,"dave"]]`)[1],
		streamTestDoneFrame(2),
	}, "\n") + "\n"

	client := &optionalDriverAgentClient{
		stdin:  &stdin,
		reader: bufio.NewReader(strings.NewReader(stdout)),
		driver: "oceanbase",
	}
	err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 1",
	}, &optionalAgentTestStreamConsumer{})
	if err == nil || !strings.Contains(err.Error(), "未知流式分片类型") {
		t.Fatalf("应返回未知分片类型错误，got %v", err)
	}

	next := &optionalAgentTestStreamConsumer{}
	if err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 2",
	}, next); err != nil {
		t.Fatalf("排空后下一个请求应正常完成: %v", err)
	}
	if len(next.rows) != 1 || next.rows[0][0] != int64(9) {
		t.Fatalf("下一个请求读到残留帧或数据异常: %#v", next.rows)
	}
}

func TestOptionalDriverAgentClientStreamTerminatesOnResponseIDMismatch(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	stdout := strings.Join([]string{
		streamTestRequestFrames(1, `[[1,"alice"]]`)[0],
		`{"id":2,"success":true,"chunkType":"rows","data":[[1,"alice"]]}`,
		streamTestDoneFrame(1),
	}, "\n") + "\n"

	client := &optionalDriverAgentClient{
		stdin:  &stdin,
		reader: bufio.NewReader(strings.NewReader(stdout)),
		driver: "oceanbase",
	}
	err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 1",
	}, &optionalAgentTestStreamConsumer{})
	if err == nil || !strings.Contains(err.Error(), "ID 不匹配") {
		t.Fatalf("应返回响应 ID 不匹配错误，got %v", err)
	}
	if client.stoppedError() == nil {
		t.Fatal("ID 不匹配后 transport 应被立即终止")
	}

	nextErr := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 2",
	}, &optionalAgentTestStreamConsumer{})
	if nextErr == nil || !strings.Contains(nextErr.Error(), "传输不可用") {
		t.Fatalf("终止后的请求应快速失败且不得读取管道，got %v", nextErr)
	}
}

func TestOptionalDriverAgentClientStreamTerminatesOnMissingDone(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	// 流未写 done 即结束（EOF）：无法确认剩余帧边界，必须回收 transport。
	stdout := strings.Join(streamTestRequestFrames(1, `[[1,"alice"]]`), "\n") + "\n"

	client := &optionalDriverAgentClient{
		stdin:  &stdin,
		reader: bufio.NewReader(strings.NewReader(stdout)),
		driver: "oceanbase",
	}
	err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 1",
	}, &optionalAgentTestStreamConsumer{})
	if err == nil || !strings.Contains(err.Error(), "读取") {
		t.Fatalf("应返回读取失败错误，got %v", err)
	}
	if client.stoppedError() == nil {
		t.Fatal("缺少 done 时 transport 应被终止")
	}

	nextErr := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 2",
	}, &optionalAgentTestStreamConsumer{})
	if nextErr == nil || !strings.Contains(nextErr.Error(), "传输不可用") {
		t.Fatalf("终止后的请求应快速失败，got %v", nextErr)
	}
}

func TestOptionalDriverAgentClientStreamTerminatesOnIDMismatchDuringDrain(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	// 排空期间出现其他请求的帧：帧边界已不可信，必须终止 transport。
	stdout := strings.Join([]string{
		streamTestRequestFrames(1, `[[1,"alice"]]`)[0],
		streamTestRequestFrames(1, `[[1,"alice"]]`)[1],
		streamTestRequestFrames(2, `[[9,"dave"]]`)[0],
		streamTestDoneFrame(1),
	}, "\n") + "\n"

	client := &optionalDriverAgentClient{
		stdin:  &stdin,
		reader: bufio.NewReader(strings.NewReader(stdout)),
		driver: "oceanbase",
	}
	consumer := &streamTestCancelingConsumer{consumeLimit: 0}
	err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 1",
	}, consumer)
	if !errors.Is(err, errStreamConsumerCanceled) {
		t.Fatalf("应返回消费端原始错误，got %v", err)
	}
	if client.stoppedError() == nil {
		t.Fatal("排空期间 ID 不匹配应终止 transport")
	}
}

func TestOptionalDriverAgentClientStreamValidatesDoneFrameID(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	// done 帧同样必须校验 ID，防止把上一个请求的 done 当作本请求的完成信号。
	stdout := strings.Join([]string{
		streamTestRequestFrames(1, `[[1,"alice"]]`)[0],
		streamTestRequestFrames(1, `[[1,"alice"]]`)[1],
		streamTestDoneFrame(2),
	}, "\n") + "\n"

	client := &optionalDriverAgentClient{
		stdin:  &stdin,
		reader: bufio.NewReader(strings.NewReader(stdout)),
		driver: "oceanbase",
	}
	err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 1",
	}, &optionalAgentTestStreamConsumer{})
	if err == nil || !strings.Contains(err.Error(), "ID 不匹配") {
		t.Fatalf("done 帧 ID 不匹配应报错，got %v", err)
	}
	if client.stoppedError() == nil {
		t.Fatal("done 帧 ID 不匹配后 transport 应被终止")
	}
}

func TestOptionalDriverAgentClientStreamValueConsumerErrorDrainsResidue(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	stdout := strings.Join([]string{
		streamTestRequestFrames(1, `[[1,"alice"],[2,"bob"]]`)[0],
		streamTestRequestFrames(1, `[[1,"alice"],[2,"bob"]]`)[1],
		streamTestDoneFrame(1),
		streamTestRequestFrames(2, `[[9,"dave"]]`)[0],
		streamTestRequestFrames(2, `[[9,"dave"]]`)[1],
		streamTestDoneFrame(2),
	}, "\n") + "\n"

	client := &optionalDriverAgentClient{
		stdin:  &stdin,
		reader: bufio.NewReader(strings.NewReader(stdout)),
		driver: "oceanbase",
	}
	consumer := &streamTestCancelingValueConsumer{consumeLimit: 0}
	err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 1",
	}, consumer)
	if !errors.Is(err, errStreamConsumerCanceled) {
		t.Fatalf("应返回消费端原始错误，got %v", err)
	}

	next := &optionalAgentTestStreamConsumer{}
	if err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 2",
	}, next); err != nil {
		t.Fatalf("排空后下一个请求应正常完成: %v", err)
	}
	if len(next.rows) != 1 || next.rows[0][0] != int64(9) {
		t.Fatalf("下一个请求读到残留帧或数据异常: %#v", next.rows)
	}
}

type streamTestCancelingValueConsumer struct {
	columns       []string
	rows          [][]interface{}
	consumeLimit  int
	consumeCalled int
}

func (c *streamTestCancelingValueConsumer) SetColumns(columns []string) error {
	c.columns = append([]string(nil), columns...)
	return nil
}

func (c *streamTestCancelingValueConsumer) ConsumeRowValues(values []interface{}) error {
	c.consumeCalled++
	if c.consumeCalled > c.consumeLimit {
		return errStreamConsumerCanceled
	}
	c.rows = append(c.rows, append([]interface{}(nil), values...))
	return nil
}

func (c *streamTestCancelingValueConsumer) ConsumeRow(row map[string]interface{}) error {
	return errStreamConsumerCanceled
}
