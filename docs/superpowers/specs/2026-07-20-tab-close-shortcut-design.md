# Cmd/Ctrl+W 标签关闭快捷键设计

- 日期：2026-07-20
- 状态：已确认，待实施
- 适用范围：GoNavi 主窗口的工作区标签和 SQL 查询结果区标签

## 1. 背景

GoNavi 当前没有统一的 `Cmd+W` / `Ctrl+W` 应用内关闭语义。工作区标签由
`TabManager` 管理，查询结果标签由每个 `QueryEditor` 的本地状态管理，两套关闭
流程拥有不同的保护规则。若分别注册全局键盘监听，同一次按键可能同时关闭结果
标签和工作区标签。

本设计增加一个可配置动作 `closeActiveTab`，由唯一的全局入口根据用户最后一次
明确交互的区域，将关闭请求路由到结果区或工作区。

## 2. 目标

1. macOS 默认使用 `Meta+W`，Windows/Linux 默认使用 `Ctrl+W`。
2. 快捷键在设置中心可修改、启用或禁用。
3. 同一次按键最多执行一个关闭动作，结果区与工作区之间不允许穿透。
4. 复用现有关闭流程，保留未保存 SQL、运行中导入任务等保护。
5. 结果区日志标签保持常驻；日志标签活跃时，快捷键隐藏整个结果区。
6. 结果区被快捷键隐藏后，连续按键不得继续关闭工作区标签。

## 3. 非目标

1. 不新增“分别关闭结果标签”和“分别关闭工作区标签”两个可配置动作。
2. 不改变鼠标关闭按钮、中键关闭或右键批量关闭的产品语义。
3. 不关闭或清空 SQL 日志数据。
4. 不改变后台导出、同步任务在工作区标签关闭后的运行方式。
5. 不统一重构所有历史浮动窗口的关闭入口。
6. 不让主窗口快捷键关闭已经拆出的独立窗口标签或独立结果窗口。

## 4. 方案选择

### 4.1 采用方案：单一全局路由器

`App` 保持唯一的全局 `keydown` capture 监听入口，维护最后一次明确交互区域，
并向目标组件派发单一、明确的关闭命令。

采用该方案的原因：

- 键盘事件只匹配和消费一次，天然避免双重关闭。
- `TabManager` 和 `QueryEditor` 继续拥有各自的状态与保护逻辑。
- 路由状态可以独立测试，不需要把查询结果状态上移到全局 store。
- 后续自定义快捷键仍复用现有快捷键设置与冲突检测体系。

### 4.2 未采用方案

- 分区独立监听：工作区和结果区分别监听 `window.keydown`。该方案存在监听顺序、
  冒泡阻断和同一 `window` 多监听器重复执行问题。
- 完全依赖 DOM 焦点：Monaco、DataGrid、Ant Design Portal 和 `body` 级事件目标会
  让焦点不足以可靠表达用户的区域意图。

## 5. 快捷键配置

### 5.1 动作定义

新增动作 `closeActiveTab`，纳入：

- `ShortcutAction`
- `SHORTCUT_ACTION_ORDER`
- `SHORTCUT_ACTION_META`
- `DEFAULT_SHORTCUT_OPTIONS`
- 快捷键设置界面和全部语言目录

动作允许在 Monaco、输入框和 DataGrid 等可编辑目标中触发，因为焦点位于编辑器
时仍应能关闭当前工作区标签。

默认绑定：

| 平台 | 组合键 | 默认状态 |
| --- | --- | --- |
| macOS | `Meta+W` | 启用 |
| Windows/Linux | `Ctrl+W` | 启用 |

GoNavi 正式接管该组合键，因此删除现有“浏览器关闭标签页”的 `Ctrl+W` 保留项；
其他浏览器、Monaco 和 DataGrid 保留项不变。

### 5.2 旧配置迁移

旧持久化配置中不存在 `closeActiveTab` 时，按平台分别迁移：

1. 若该平台没有任何已启用动作占用新默认组合键，补入启用的新动作。
2. 若已有动作占用 `Meta+W` 或 `Ctrl+W`，保留原动作及绑定，补入组合键相同但
   `enabled: false` 的新动作。
3. 用户可在快捷键设置中修改冲突绑定并重新启用新动作。
4. “恢复默认值”和全新安装始终得到启用的默认绑定。

迁移只处理缺少新动作的旧配置，不覆盖用户已经保存的 `closeActiveTab` 设置。

禁用动作或把动作改绑到其他组合键后，默认 `Meta+W` / `Ctrl+W` 不再执行标签
关闭，但主窗口仍必须消费该平台原生关闭组合键，防止 WebView 把它解释为关闭应用
窗口或浏览器标签。

## 6. 路由状态模型

全局路由器维护 `CloseShortcutScope`：

```ts
type CloseShortcutScope = 'workspace' | 'result' | 'blocked';
```

初始状态为 `workspace`。

| 当前/触发条件 | 下一状态 | 含义 |
| --- | --- | --- |
| 用户点击或聚焦结果区 | `result` | 关闭请求只发送给当前查询结果区 |
| 用户点击或聚焦编辑器、工作区标签栏或侧边栏 | `workspace` | 关闭请求只发送给主工作区 |
| 快捷键在日志标签上隐藏结果区 | `blocked` | 后续重复按键只消费，不关闭任何标签 |
| `blocked` 后用户明确交互工作区 | `workspace` | 允许重新关闭工作区标签 |
| `blocked` 后用户明确交互重新显示的结果区 | `result` | 允许关闭结果标签或再次隐藏结果区 |
| 用户点击或聚焦独立结果窗口 | `blocked` | 独立窗口交互不得沿用后台工作区归属 |

SQL 执行后程序化展示结果、程序化切换结果标签、store 激活标签等行为不得修改
该状态。只有真实的 `pointerdown` 或 `focusin` 才能改变区域归属。

结果区根节点增加 `data-gonavi-close-shortcut-scope="result"`。路由器在 document
capture 阶段监听 `pointerdown` 和 `focusin`，通过该标记识别结果区；编辑器、
工作区标签栏和侧边栏归入工作区。

交互浮层与独立结果窗口使用稳定的
`data-gonavi-close-shortcut-guard="true"` 标记或统一 guard class。guard 包含当前可见
的模态框、抽屉、Dropdown、上下文菜单、Select/Picker 弹层、自建交互 Portal 和
`.gn-detached-result-window`。标记仅在浮层打开时处于 active 状态；若组件会保留
隐藏 DOM，公共 helper 还必须检查元素的可见性。Tooltip、拖拽预览等不可获得输入
焦点的纯展示 Portal 不属于 guard。

普通浮层 guard 内的 `pointerdown` 和 `focusin` 不改变后台区域归属。关闭快捷键
来自 guard 内部时，只消费事件，不向工作区或结果区派发命令。

独立结果窗口是例外：其根节点同时标记
`data-gonavi-close-shortcut-scope="blocked"`。可信的 `pointerdown` 或 `focusin`
发生在窗口内部时，立即把路由 ref 写为 `blocked`。这覆盖标题栏拖动等不会夺取
后台 Monaco 焦点的交互；之后即使 `keydown.target` 仍是 Monaco，也不得关闭主
工作区。只有用户再次明确交互主工作区或主结果区才恢复对应归属。

会遮挡后台交互的浮层另加
`data-gonavi-close-shortcut-blocks-background="true"`；只要此标记的节点当前可见，
即使键盘事件目标落在 `body`，也只消费、不关闭后台标签。模态框、抽屉、交互
Dropdown/上下文菜单、Select/Picker 弹层使用该标记。独立结果窗口只使用普通
guard，不使用 background blocker，避免窗口存在时永久禁用主工作区快捷键。

## 7. 键盘事件流

```text
全局 keydown capture
  -> 不受 IME 过滤的底层组合键解析
  -> 是否命中平台原生关闭键，或已启用的 closeActiveTab 绑定
  -> 快捷键录制器优先接管
  -> 命中平台原生关闭键时无条件 preventDefault
  -> IME/guard 命中时只消费，不派发
  -> 解析当前组合键的已启用动作 owner
       其他动作 -> 交给原动作处理一次
       closeActiveTab -> 读取 CloseShortcutScope 并路由
       无 owner 且为平台原生关闭键 -> 消费为 no-op
```

事件处理约束：

1. `App` 是主窗口唯一的全局关闭快捷键入口。
2. 增加一个只做键位与修饰键比较、不会因 IME 状态返回 false 的底层 matcher。
   它仅用于判断事件是否需要被应用接管；正常动作执行仍使用现有
   `isShortcutMatch` 语义。
3. 路由器分别计算“平台原生关闭组合键”和“当前已启用动作绑定”的底层匹配，
   同时按 `SHORTCUT_ACTION_ORDER` 解析当前组合键的已启用 owner。快捷键设置继续
   保证同一平台不会新增多个启用 owner；遇到历史重复数据时按现有动作顺序只取
   第一个。
4. 快捷键录制器拥有优先权。录制期间全局路由器直接退出，由录制器负责
   `preventDefault` 和保存绑定，不执行关闭动作。
5. 除录制器分支外，底层 matcher 一旦命中平台原生关闭组合键，必须立即
   `preventDefault`，再判断 owner 和当前上下文。绑定 owner 存在但因可编辑目标、
   当前标签类型或组件未挂载而无法执行时，动作可以 no-op，WebView 默认关闭仍然
   必须被抑制。
6. IME composing、全局 composition 状态或 keyCode/which 229 命中时，底层 matcher
   仍能识别组合键并消费，但不得派发关闭。
7. 事件目标位于 guard 内，或存在可见的 background blocker 时，只消费、不关闭
   后台标签。
8. 若 owner 是 `closeActiveTab`，才进入本设计的工作区/结果区路由。若 owner 是
   其他历史动作，关闭路由不得抢占或改成 no-op：全局动作继续由 App switch 执行，
   查询编辑器动作继续交给其现有 owner，并且整条链路只执行该动作一次。
9. 只有平台原生关闭键没有任何已启用 owner 时，才由保护分支消费为 no-op。
10. 关闭路由、IME/guard 保护和无 owner 的平台 no-op 在 `preventDefault` 后使用
   `stopImmediatePropagation`，避免 WebView 或同一 `window` 上的其他监听器再次
   处理。交给其他 owner 的事件不得在 owner 执行前被关闭路由
   `stopImmediatePropagation`，但第 5 条的 `preventDefault` 仍已生效。
11. 一次事件只允许派发一个目标命令，不允许在目标无效时回退到另一区域。
12. `document.body`、`document.documentElement` 等文档级目标按已记录状态路由。
13. `closeActiveTab` 禁用或改绑，且没有其他已启用 owner 时，平台原生
    `Meta+W` / `Ctrl+W` 仍被消费为 no-op；自定义绑定只有在动作启用时才被接管。
14. 若真机验证发现 WebView 不向前端交付 `Cmd/Ctrl+W`，才增加 Wails 原生事件
   fallback；fallback 必须汇入同一路由器并具备单次事件去重，不能形成第二套关闭
   流程。

## 8. 工作区关闭契约

工作区命令由 `TabManager` 处理，目标必须是 `dockedActiveTabId`，不得使用全局
`activeTabId`。不存在主窗口活动标签时，命令为 no-op。

关闭必须复用：

```ts
closeTabsWithSQLFilePrompt(
  [dockedActiveTabId],
  () => closeTab(dockedActiveTabId),
);
```

由此保留：

- 外部 SQL 文件未保存时的保存、丢弃、取消确认。
- 外部 SQL 文件被移动或删除时的确认。
- 防止重复打开关闭确认。
- 运行中的 `data-import` 工作台关闭保护。
- store 已有的关闭后活动标签选择和关联资源清理。

`table-export` 与 `data-sync` 的任务状态独立于标签组件，仍允许关闭工作区标签并
在后台继续运行。

## 9. 结果区关闭契约

结果区命令只发送给主窗口当前活动的 `QueryEditor`，由它读取本地
`activeResultKey` 和 `resultSets`。组件提取一个共享的纯函数
`resolveEffectiveActiveResultKey`，供结果区渲染和快捷键命令共同使用，不能一方
读取原始 key、另一方使用视觉回退 key。

在支持嵌入 SQL 日志标签的结果区中，日志标签只要结果区可见就无条件存在，日志
数量为 0 时也显示；其 key 统一使用 `QUERY_EDITOR_SQL_LOG_TAB_KEY`。

具体行为：

1. 当前键对应真实结果标签时，调用现有 `handleCloseResult`。
2. 关闭后由现有逻辑选择相邻结果标签，不在路由器中重复计算。
3. 关闭最后一个真实结果标签后，活动状态明确切到日志 key，结果区继续显示常驻
   日志标签；即使历史状态中原始 key 为空，共享 resolver 也必须得到同一日志 key。
4. 当前键为日志标签时，不删除日志；隐藏整个结果区，并向路由器回报
   `hidden`，使路由状态进入 `blocked`。
5. 当前键缺失、过期或不属于真实结果与日志时，消费请求并回报 `ignored`，不得
   回退关闭工作区。
6. 结果区已经隐藏时，结果命令为 no-op，仍不得穿透到工作区。

结果命令需要一个明确的完成回报 `closed | hidden | ignored`。命令派发和回报必须
在当前 `keydown` 调用栈内同步完成，不使用 Promise 或等待 React render。可通过
同步 `dispatchEvent` 的可变 request detail 或等价的同步命令注册表返回 outcome。

路由状态以 ref/原子值为准，键盘监听不得读取可能滞后的 React state。收到
`hidden` 后，必须在监听器返回前写入 `scopeRef.current = 'blocked'`；`closed` 和
`ignored` 保持 `result`。因此即使同一 task 内连续派发两个 `keydown`，第二次也会
读到 `blocked`。

结果命令同样读取 `resultSetsRef` 与 `activeResultKeyRef`。关闭动作在提交 React
state 更新的同时同步写入这两个 ref，使同一 task 内的下一次命令能看到相邻结果
或日志 key，而不是重复处理已经关闭的结果。

独立结果窗口不向主窗口发送工作区关闭命令。主窗口路由器也不控制独立结果窗口
的生命周期。

## 10. 错误与竞态处理

- 快速重复按键：工作区沿用关闭确认的互斥保护；结果区每次根据最新本地状态
  处理。日志隐藏后立即切换为 `blocked`。
- 结果标签关闭与查询完成并发：以命令处理时的最新 `activeResultKey` 为准；无效
  key 返回 `ignored`。
- 活动工作区标签在事件间切换：`TabManager` 在命令处理时读取最新
  `dockedActiveTabId`。
- 组件卸载：命令没有有效接收者时 no-op，不向另一区域补发。
- 自定义绑定冲突：继续使用现有冲突提示；运行时不同时执行两个动作。

## 11. 测试设计

### 11.1 快捷键工具测试

- 新动作默认绑定、动作顺序、元信息和平台显示。
- 新动作允许在可编辑目标触发。
- `Ctrl+W` 不再报告浏览器保留冲突。
- 自定义绑定、禁用和恢复默认值。
- 动作禁用或改绑后，平台原生关闭组合键仍被消费但不关闭标签或窗口。
- 旧配置无冲突时自动启用新动作。
- 旧配置占用默认组合键时保留旧动作并禁用新动作，且按平台隔离。
- 迁移后按原生关闭组合键仍只执行原动作一次，不执行关闭动作，WebView 也不关闭。
- 历史 owner 因可编辑目标、非查询标签或组件未挂载而无法执行时，不执行任何动作，
  但仍阻止 WebView 原生关闭。
- 所有语言包含新动作的 label/description。

### 11.2 路由器测试

- 初始状态关闭工作区，不触发结果区。
- 明确点击结果区后只关闭结果标签。
- 点击 Monaco、工作区标签栏或侧边栏后只关闭工作区标签。
- SQL 执行后程序化激活结果不抢占归属。
- 日志标签隐藏结果区并进入 `blocked`。
- `blocked` 状态连续按键不关闭工作区；明确交互工作区后才恢复。
- 无效结果状态只消费，不穿透工作区。
- `body` 和 `documentElement` 目标使用最后明确区域。
- 快捷键录制期间不执行关闭。
- IME composing / keyCode 229 下，底层 matcher 仍消费默认或自定义关闭组合键，但
  不执行关闭。
- 模态框、抽屉、下拉菜单和 Portal 活跃时不关闭后台标签。
- Tooltip 和拖拽预览等纯展示 Portal 不触发 guard。
- 保持后台 Monaco 焦点，初始状态为 `workspace` 时点击不可聚焦的独立结果窗口
  标题栏，再按快捷键也不得关闭主工作区。
- 独立结果窗口仅仅存在时，不阻止主工作区内正常使用关闭快捷键。
- 可见 background blocker 存在且事件目标为 `body` 时也不得关闭后台标签。
- 同一个键盘事件最多派发一个关闭命令。
- `hidden` 回报后不等待重渲染，立即连续派发第二个事件仍保持 blocked。

### 11.3 工作区集成测试

- 使用 `dockedActiveTabId`，独立窗口处于全局 active 时也不关错标签。
- 外部 SQL 脏文件保留保存/丢弃/取消流程。
- 外部 SQL 文件丢失确认仍生效。
- 运行中数据导入工作台无法被快捷键关闭。
- 导出、同步工作台标签允许关闭，后台任务继续。
- 没有 docked 标签时 no-op。

### 11.4 结果区集成测试

- 关闭真实结果标签并正确选择相邻标签。
- 关闭最后一个真实结果后显示日志标签。
- 关闭最后一个真实结果后，命令和渲染共同解析为日志 key；下一次快捷键隐藏
  结果区。
- 日志标签不会被删除，结果区整体隐藏。
- 计数请求等现有清理逻辑仍由 `handleCloseResult` 执行。
- 结果区隐藏、active key 过期、组件卸载时均不关闭工作区。
- 独立结果窗口不会把命令路由回主工作区。

### 11.5 真机验收

- macOS 触摸板、Monaco、DataGrid 和普通面板焦点下验证 `Cmd+W`。
- Windows/Linux 对应验证 `Ctrl+W`。
- 验证 WebView 不执行原生窗口或浏览器标签关闭。
- 验证自定义组合键、完全禁用状态及 IME 组合输入；改绑或禁用后默认平台关闭键
  仍是应用内 no-op。

## 12. 验收标准

1. 默认快捷键、自定义和禁用均按平台生效。
2. 结果区、工作区和 `blocked` 三种状态的路由符合本设计。
3. 一次按键不会同时关闭结果标签和工作区标签。
4. 日志标签始终保留；日志活跃时隐藏的是整个结果区。
5. 隐藏结果区后连续按键不会误关工作区标签。
6. 现有 SQL 文件和数据导入保护没有被绕过。
7. 旧用户配置不会因升级被静默覆盖或产生双动作。
8. 自动化测试和 macOS/Windows 真机验证通过。

## 13. 预计影响文件

- `frontend/src/utils/shortcuts.ts`
- `frontend/src/App.tsx`
- `frontend/src/components/TabManager.tsx`
- `frontend/src/components/QueryEditor.tsx`
- `frontend/src/components/QueryEditorResultsPanel.tsx`
- `frontend/src/i18n/catalog.ts` 及目录完整性测试
- 快捷键、App、TabManager、QueryEditor 相关测试文件
