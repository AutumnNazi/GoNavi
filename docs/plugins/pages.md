# 插件页面、菜单与宿主能力（v1 契约）

本文件是「插件开放菜单／页面／导航 + 宿主能力网关」的 **v1 冻结契约**，同时作为实现与验收依据。目标是让插件像第一方功能一样进入 GoNavi 主窗口：声明页面、把页面挂到菜单／导航、在页面里按权限调用宿主能力。v1 只落地安全、可验证的最小闭环；其余能力按本文的目录分阶段开放。

实现位置：宿主校验在 [internal/plugin/pages.go](<../../internal/plugin/pages.go>)，唯一绑定在 [internal/app/methods_plugin_pages.go](<../../internal/app/methods_plugin_pages.go>)，双语言 SDK 在 [sdk/go/pages_validation.go](<../../sdk/go/pages_validation.go>) 与 [sdk/typescript/src/pagesDeclaration.ts](<../../sdk/typescript/src/pagesDeclaration.ts>)，可检查示例在 [examples/plugins/pages](<../../examples/plugins/pages/README.md>)。权限口径见[权限参考](<permissions.md>)，接线细节见[协议的清单与页面桥](<protocol.md#manifest-pages-and-navigation>)，SDK 用法见 [SDK 指南](<sdk.md>)。

## 1. 清单贡献

在现有 `contributes` 上新增两个可选数组（其余贡献点不变）：

```json
{
  "contributes": {
    "pages": [
      { "id": "overview", "title": "Overview", "body": { "type": "text", "text": "hello" } },
      { "id": "dashboard", "title": "Dashboard", "html": { "source": "<h1>…</h1>" } }
    ],
    "navigation": [
      { "id": "overview-tools", "title": "Overview", "page": "overview", "location": "tools", "order": 0 }
    ]
  }
}
```

### 1.1 pages

- `id`：`localIDPattern`（`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`），同插件内唯一。
- `title`：非空文本，≤256 字节（首尾空白不算内容）。
- `body` 与 `html` **恰好二选一**；两者都缺失或同时出现都拒绝。
- `body`：沿用现有声明式 `UINode` 校验（类型限 text/alert/column/row/button/table；深度 ≤16、节点 ≤512；button 只能引用已声明 command）。节点预算在**整个 manifest 的所有页面之间累计**，与 `panels` 一致。
- `html.source`：沿用 `HTMLPanel` 校验（非空 UTF-8、≤256 KiB、不含 NUL）。
- 最多 32 个页面。

### 1.2 navigation

- `id`：`localIDPattern`，同插件内唯一（与 pages 的 id 命名空间独立）。
- `title`：非空文本，≤256 字节。
- `page`：必须引用本插件已声明的 page id。
- `location`：v1 只接受 `"tools"`（标题栏「插件」菜单）。枚举保留扩展位，未知值拒绝。
- `order`：可选整数，`-1000..1000`，默认 0；同插件内按升序展示，相同 order 按声明顺序。
- 最多 32 条导航。

### 1.3 权限

| 权限 | 作用 |
|---|---|
| `ui.pages` | 渲染 `pages` 并把 `navigation` 挂到主窗口；缺失时 pages/navigation 声明直接校验失败 |
| `ui.html-panel` | 允许声明 `html` 页面（复用现有权限语义；v1 起同时允许页面通过桥调用已授权宿主能力） |
| `host.connections.read` | 读取脱敏后的保存连接列表 |
| `host.metadata.read` | 读取已保存连接的数据库／表／列元数据 |
| `host.query.read` | 通过已保存连接执行单条只读查询（见 2.3；v1 已接通只读连接、SQL 审计与超时路径） |

- `ui.pages` 是页面与导航的前置条件；`host.*` 权限只影响对应能力调用，不隐式授予页面渲染。
- 未声明 `ui.pages` 的包仍可只使用旧的面板／窗口能力。
- 只有处于 `running` 的插件才展示入口；静态包（无 backend）在运行时所有者启动后同样进入 `running`，只是没有子进程。

## 2. 宿主能力网关

### 2.1 绑定

```go
// 唯一的新增 Wails 绑定；其余能力都经它分派。
func (a *App) PluginPageCall(id, pageID, method, argumentsJSON string) connection.QueryResult
```

- 成功：`{ success: true, data: <能力结果> }`。
- 失败：`{ success: false, message: <i18n 文案>, data: { code } }`。
- 限制：参数 ≤64 KiB；结果序列化后 ≤256 KiB；执行超时 30s（网关计时：支持 context 的驱动可被中断，legacy 驱动可能继续执行，见 2.3）；Web 运行时未开启插件管理时整体拒绝并返回 `management_denied`。
- 校验顺序：插件存在 → 期望启用且实际 running → page 在该插件 manifest 中声明 → 方法已登记 → 调用方具备该方法的权限 → 参数合法 → 执行。
- 该绑定不是通用反射入口：方法必须逐项登记，未登记即 `unknown_method`。

### 2.2 错误码

失败码以 `page_` 为前缀返回：`data.code` 形如 `page_not_running`，文案键为 `plugin.backend.error.page_not_running`。条件码集合：`invalid_identity`、`not_running`、`not_declared`、`permission_denied`、`unknown_method`、`invalid_arguments`、`result_too_large`、`internal`；`unsupported` 保留给尚无法安全接通的扩展能力（v1 已登记的 7 个方法都不返回它）。前端同时兼容带前缀与裸码两种拼写。`management_denied` 沿用现有键且不带 `page_` 前缀，用于 Web 运行时未开启插件管理时的整体拒绝。前端桥本地错误用 `plugin.pages.error.bridge`／`plugin.pages.error.timeout`；页面拿到的 Promise 拒绝原因就是本地化后的文案。

### 2.3 能力目录 v1

| 方法 | 权限 | 参数 | 结果 |
|---|---|---|---|
| `app.info` | 无（需 page） | `{}` | `{ hostVersion, pluginId, pluginVersion, locale, runtime: "desktop" \| "web" }` |
| `connections.list` | `host.connections.read` | `{}` | 脱敏数组：`{ id, name, type, host, port, database, environmentType, readOnly }`；不含用户名、密码、SSH／代理凭据、DSN |
| `metadata.databases` | `host.metadata.read` | `{ connectionId }` | `[string]`，≤2000 项 |
| `metadata.tables` | `host.metadata.read` | `{ connectionId, database }` | `[{ name, type? }]`，≤5000 项 |
| `metadata.columns` | `host.metadata.read` | `{ connectionId, database, table }` | `[{ name, type, nullable? }]`，≤5000 项 |
| `query.read` | `host.query.read` | `{ connectionId, sql, maxRows? }` | `{ columns: [{name,type?}], rows: [[…]], truncated, elapsedMs }`；maxRows 1..1000，默认 100；扫描层行预算为 maxRows+1 |
| `ui.notify` | 无（前端本地处理） | `{ message, type? }` | 无；在页面桥内直接展示 antd message |

- 连接一律用**保存连接 ID** 解析，插件永远拿不到凭据；宿主侧从现有仓储／secretstore 取完整配置。
- `connections.list` 的 `readOnly` 是**有效只读**：连接模式本身支持只读且被强制只读时才为 `true`，不能当成「这次查询不会改数据」的承诺。多主机／副本集连接可能没有单一 `host`／`port`，这两个字段可为空。
- `query.read` 只接受单条只读语句（SELECT／WITH／SHOW／DESCRIBE／EXPLAIN），拒绝多语句、写入与可执行注释；直接复用宿主现有查询路径，因此只读连接策略、SQL 审计（来源 `plugin_page`）与执行超时与内置查询完全一致。页面不能指定数据库、不能提交多条语句、也拿不到连接凭据。
- **只读 ≠ 无副作用**：SELECT 仍可能触发锁等待、序列推进或函数副作用。v1 额外拒绝 `FOR UPDATE`／`FOR NO KEY UPDATE`／`FOR SHARE`／`FOR KEY SHARE`／`LOCK IN SHARE MODE`／`UPDLOCK`／`HOLDLOCK` 与 `nextval(`／`setval(`／`pg_terminate_backend(`／`pg_read_file(`，命中返回 `page_invalid_arguments`；`pg_advisory_lock`、`pg_sleep`、用户自定义函数等其他副作用**未穷举**，按受信插件代码边界对待。
- `query.read` 在**扫描层**绑定行预算（`maxRows+1`，用于区分恰好 maxRows 与超限）：支持行预算的驱动到上限即停止物化；只有 legacy 查询的驱动会先读完再由网关截断，不因此拒绝查询。`truncated` 由「行数超过 maxRows」「预算已截断」「驱动截断标记」任一决定；结果序列化仍受 256 KiB 网关上限约束。
- **30s 超时**由网关计时：支持 context 的驱动（`QueryContexter`）可被中断；legacy 驱动无法中断，宿主会等驱动返回后再收尾，若此时已超时则返回 `page_internal`。页面桥自身另有 30s 本地超时，通常会先失败。
- 若未来某能力无法复用安全路径，应返回 `unsupported` 并归入阶段 2，**不得**降级为无审计直连。

### 2.4 能力扩展

新增能力 = 一条登记项（方法名、权限、参数上限、处理器）+ 文档 + 测试；处理器只放 `internal/app/plugin_page_capabilities*.go`。目录按域分批开放（连接、元数据、查询、导出、AI、数据同步、驱动、设置、市场、JVM…），每批必须单独评审权限与审计边界。

## 3. 主窗口呈现

- 新增工作台标签页类型 `plugin-page`，`TabData.pluginPage = { pluginID, pageID, title }`。
- 页面内容：声明式页面复用 `DeclarativePanel`；HTML 页面复用 `sandboxedPanelDocument` 的 CSP 包装并注入桥运行时。
- 入口：
  1. 标题栏新增「插件」快捷菜单，列出所有 running 插件的 `navigation`（location=tools），点击打开对应标签页；懒加载，首次打开菜单时读取，不改变启动时插件运行时初始化时机。
  2. 设置中心 →「插件」页每个插件卡展示其页面列表与「打开」按钮。
- 插件被禁用／移除／换代时：已打开页面显示不可用状态并停止桥调用；错误码 `not_running`。
- 页面标签页标题使用 navigation.title；同一 (pluginID,pageID) 复用已有标签页。
- 页面标签页**不跨重启恢复**：`plugin-page` 不在工作台 session snapshot 的恢复集合内，重启后需重新从菜单打开。
- Web 运行时且 `managementAllowed=false` 时：标题栏「插件」菜单不列出可点击条目，插件卡里的「打开」按钮禁用并显示提示（`plugin.pages.web_unavailable`）；桌面端或允许管理时保持原行为。

### 3.1 页面桥协议（HTML 页面）

- iframe：`sandbox="allow-scripts"`，不透明源，CSP 与现有 HTML 面板一致（禁止网络／外部资源／表单／嵌套 frame）。
- **网络边界只覆盖主动请求**：CSP 阻止页面 fetch／XHR／WebSocket、外部子资源、表单提交与嵌套 frame，但**不阻止页面自我导航**。为此宿主为每个 frame 生成随机 `token` 并注入桥 closure；`gonavi:page-call` 必须携带该 token，缺失或不符的消息直接丢弃（不回 `page-result`，也不触发宿主调用）。注入脚本执行后自移除，且出站 `postMessage` 在页面脚本之前绑定，页面无法从 DOM 读回 token 或替换发送入口。
- iframe 的 `load` 计数>1（srcdoc 初始加载之后再次 load）视为自导航逃逸：立即卸载 iframe、撤销桥并显示不可用态（`plugin.pages.unavailable` + `plugin.pages.error.navigation`）。
- 因此页面仍可能通过自我导航把**已经获得的数据**带出（例如跳转外部 URL）；这是受信插件代码的边界，不是网络隔离承诺。`host.*` 返回的数据应理解为「暴露给已声明该权限的插件代码」，不是「绝不会离开进程」。
- 注入运行时：`window.gonavi.call(method, args) -> Promise` 与 `window.gonavi.notify(message, type)`。
- 消息：页面 → 宿主 `{type:"gonavi:page-call", id, token, method, arguments}`；宿主 → 页面 `{type:"gonavi:page-result", id, ok, value|error}`。
- 宿主只接受 `event.source === iframe.contentWindow` 的消息；单页最多 8 个并发请求、每次调用 30s 超时、参数 ≤64 KiB；组件卸载后丢弃迟到响应。
- 限流：页面桥调用 30 次／10s 滑动窗口，`notify` 单独 10 次／10s；超限统一回 `plugin.pages.error.bridge`。
- 声明式页面没有 `window.gonavi`：它只能通过 `button.command` 调用插件自己的命令。

## 4. i18n

新增键（六语言同步）：

- `plugin.pages.title`、`plugin.pages.open`、`plugin.pages.empty`、`plugin.pages.unavailable`、`plugin.pages.menu`、`plugin.pages.loading`
- 页面桥运行时错误：`plugin.pages.error.bridge`（含限流）、`plugin.pages.error.timeout`、`plugin.pages.error.navigation`（自导航逃逸）
- Web 入口提示：`plugin.pages.web_unavailable`
- 权限标签：`plugin.permission.ui_pages`、`plugin.permission.host_connections_read`、`plugin.permission.host_metadata_read`、`plugin.permission.host_query_read`
- 后端文案：`plugin.backend.error.page_` + 上面 9 个 code（`management_denied` 已存在，不重复）

## 5. 测试与验收

- Go：`go test ./internal/plugin -run 'Page|Navigation|Manifest'`；`go test ./internal/app -run 'PluginPage'`；`go build ./...`；`go vet` 相关包。
- SDK：`cd sdk/go && go test ./...`；`node frontend/node_modules/typescript/bin/tsc -p sdk/typescript/tsconfig.json`；`node frontend/node_modules/vitest/vitest.mjs run --root sdk/typescript --config vitest.config.mjs`；示例包 `cd examples/plugins && go test ./pages`。
- 前端：`npm run test -- src/plugins src/pluginPages`；`npx tsc --noEmit`；六语言键对齐测试。
- 文档：`go test ./internal/plugin -run 'Docs|Link'`；`tools/i18n-scan` 不新增硬编码中文。
- 真实渲染（Wails 窗口）单独标注为未验证，不以单测代替。

## 6. 非目标（v1 明确不做）

- 不把全部 483 个 Wails 绑定直接暴露给插件；能力必须逐项登记、授权、审计。
- 不提供原生菜单栏／右键菜单注入（`location` 先只做 tools）。
- 不提供页面自定义网络请求；HTML 页面的 CSP 保持 `connect-src 'none'`。
- CSP 不是网络隔离：只阻止页面主动请求，不阻止自我导航。导航后宿主撤销桥并显示不可用，但已获得的数据仍可能被带出（受信插件边界）。
- 不提供插件间页面互调。
