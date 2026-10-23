# 宿主身份：host.describe

插件可以读取**当前进程**的身份，不能用参数指定别的插件。需要权限 `host.describe`。参数必须是空对象或省略。

```json
{"jsonrpc":"2.0","id":"hl-1","method":"host.describe","params":{}}
{"jsonrpc":"2.0","id":"hl-1","result":{"pluginId":"example.hello","generation":3,"hostVersion":"0.6.5","locale":"zh-CN"}}
```

`pluginId` 和 `generation` 来自宿主绑定的实例。`hostVersion` 和 `locale` 是宿主启动时的值，不是插件自己填写的。未授权返回 `-32003`。它和 `host.log` 共用每秒 8 次的宿主调用额度。

Go 处理器调用 `Host.Describe`。TypeScript 调用 `Protocol.describe(signal)`。返回值只保留 `pluginId`、`generation`、`hostVersion` 和 `locale`。这不提供配置、数据库、文件或任意方法。
