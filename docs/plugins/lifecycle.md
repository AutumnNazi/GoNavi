# 生命周期通知

插件进程完成握手并进入运行状态后，宿主发送一次无回复的通知：

```json
{"jsonrpc":"2.0","method":"plugin.lifecycle","params":{"event":"running","generation":1}}
```

通知不占用请求 ID，失败或队列满时直接丢弃，不阻止启用。禁用仍然先撤销调用，再用现有的 `plugin.shutdown` 和进程取消收尾，不会额外等待这个回调。

Go SDK 用 `Options.OnLifecycle`。TypeScript 用 `Protocol` 的 `onLifecycle`。只有 `event` 为 `running` 且 generation 为正整数时才会回调。回调上下文可以调用 `host.log`。[Hello 示例](<../../examples/plugins/hello/main.go>)在运行通知里写一条诊断。带请求 ID 的同名方法不是通知，仍按未知方法拒绝。
