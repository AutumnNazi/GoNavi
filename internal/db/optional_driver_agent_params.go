package db

import (
	"context"
	"errors"
	"fmt"
)

// 参数绑定仅在协议版本 V2 的 agent 上开放：旧版 agent 会静默忽略 Args 字段，
// 导致含占位符的 SQL 原样下发到数据库。宁可拒绝执行并提示升级，也不能让
// 用户收到莫名的语法错误。
//
// 已知限制：Args 经 JSON-lines 往返，time.Time 会序列化为 RFC3339 字符串、
// 整数解码为 float64——agent 侧驱动按字符串/浮点绑定，日期时间的会话时区
// 与隐式转换由驱动决定。直接编译（内置驱动）路径不受影响。

// ErrOptionalDriverAgentParamsUnsupported 表示当前 agent 协议不支持参数绑定。
var ErrOptionalDriverAgentParamsUnsupported = errors.New("驱动代理不支持参数绑定")

func optionalAgentParamsUnsupportedError(driverType string) error {
	return fmt.Errorf("%w：%s 驱动代理版本过低，请在驱动管理中升级驱动代理后重试", ErrOptionalDriverAgentParamsUnsupported, driverDisplayName(driverType))
}

// agentSupportsParameterBinding 判断 connect 响应回显的协议是否携带参数通道。
func agentSupportsParameterBinding(protocolSchema string) bool {
	return protocolSchema == OptionalDriverAgentProtocolSchemaV2
}

func (d *OptionalDriverAgentDB) QueryContextWithArgs(ctx context.Context, query string, args []any) ([]map[string]interface{}, []string, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	client, err := d.requireClient()
	if err != nil {
		return nil, nil, err
	}
	if !agentSupportsParameterBinding(client.schema()) {
		return nil, nil, optionalAgentParamsUnsupportedError(d.driverType)
	}
	var data []map[string]interface{}
	var fields []string
	var messages []string
	if err := client.callContext(ctx, optionalAgentRequest{
		Method:    optionalAgentMethodQuery,
		Query:     query,
		Args:      args,
		TimeoutMs: timeoutMsFromContext(ctx),
	}, &data, &fields, &messages, nil); err != nil {
		return nil, nil, err
	}
	return data, fields, nil
}

func (d *OptionalDriverAgentDB) ExecContextWithArgs(ctx context.Context, query string, args []any) (int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	client, err := d.requireClient()
	if err != nil {
		return 0, err
	}
	if !agentSupportsParameterBinding(client.schema()) {
		return 0, optionalAgentParamsUnsupportedError(d.driverType)
	}
	var affected int64
	if err := client.callContext(ctx, optionalAgentRequest{
		Method:    optionalAgentMethodExec,
		Query:     query,
		Args:      args,
		TimeoutMs: timeoutMsFromContext(ctx),
	}, nil, nil, nil, &affected); err != nil {
		return 0, err
	}
	return affected, nil
}

// optionalDriverAgentSession 的参数化方法走 callContext 多返回值指针形态，
// 与既有 session 查询保持一致。

func (s *optionalDriverAgentSession) QueryContextWithArgs(ctx context.Context, query string, args []any) ([]map[string]interface{}, []string, error) {
	if err := s.ensureOpen(); err != nil {
		return nil, nil, err
	}
	if !agentSupportsParameterBinding(s.client.schema()) {
		return nil, nil, optionalAgentParamsUnsupportedError(s.driver)
	}
	client := s.client
	var data []map[string]interface{}
	var fields []string
	var messages []string
	if err := client.callContext(ctx, optionalAgentRequest{
		Method:    optionalAgentMethodQuery,
		SessionID: s.sessionID,
		Query:     query,
		Args:      args,
		TimeoutMs: timeoutMsFromContext(ctx),
	}, &data, &fields, &messages, nil); err != nil {
		return nil, nil, err
	}
	return data, fields, nil
}

func (s *optionalDriverAgentSession) ExecContextWithArgs(ctx context.Context, query string, args []any) (int64, error) {
	if err := s.ensureOpen(); err != nil {
		return 0, err
	}
	if !agentSupportsParameterBinding(s.client.schema()) {
		return 0, optionalAgentParamsUnsupportedError(s.driver)
	}
	client := s.client
	var affected int64
	if err := client.callContext(ctx, optionalAgentRequest{
		Method:    optionalAgentMethodExec,
		SessionID: s.sessionID,
		Query:     query,
		Args:      args,
		TimeoutMs: timeoutMsFromContext(ctx),
	}, nil, nil, nil, &affected); err != nil {
		return 0, err
	}
	return affected, nil
}
