# 宿主能力：host.log

插件可以在自己的进程里向宿主发送一条有界诊断，不能借此读取配置、数据库、文件或任意宿主方法。

需要权限 `host.log`。请求只在该插件当前进程仍然存活时有效。禁用、退出或换代后拒绝。未声明权限返回错误码 `-32003`，参数不合法返回 `-32602`，超过每秒 8 条返回 `-32001`。其它方法名仍然返回 `-32601`。

```json
{"jsonrpc":"2.0","id":"log-1","method":"host.log","params":{"level":"info","message":"snapshot ready"}}
{"jsonrpc":"2.0","id":"log-1","result":{}}
```

`level` 只能是 `info` 或 `warn`。`message` 必须是 1 到 1024 字节的有效 UTF-8，不能含 NUL。宿主把插件 ID 和原文写入诊断日志，不脱敏、不展示到界面，也不证明消息不含密钥。Go 处理器可从上下文取出 `HostFromContext` 并调用 `Log`。TypeScript `Protocol.log(level, message, signal)` 发送同一帧并等待宿主返回对象。两者都拒绝非法 level 或超长消息，且不会开放其它宿主方法。
