# 插件生态：当前实现与验证状态

**当前已实现插件运行／分发闭环、只读 SQL 数据源、显式加载的 Skills，以及原生 AI Provider 的文本／工具流式接入；Web 插件管理默认只读，需服务器显式开启；仍不是完整 DSH 功能对齐，也不代表已经上线官方市场。** 本页记录 2026-10-19 至 2026-10-21 的工作区交付范围与验收结果；“代码已实现”“自动化测试通过”“真实环境已验证”分开说明。

## 从哪里开始

桌面入口：**设置中心 → 数据与安全 → 插件**，分为本地插件与插件市场。

1. **本地安装**：选择目录、ZIP 或 TGZ/tar.gz，检查真实包的清单、权限和内容摘要，明确确认信任后安装。新安装默认禁用；启用后查看期望状态与实际运行状态，不把“已接受启用”当作启动成功。若检查到的清单属于已安装插件，确认动作会走**替换**：沿用当前启用状态，替换失败时保留原有包。
2. **市场安装**：先配置可访问的市场源。安装预览会下载并检查实际归档，不仅展示服务端提供的清单。确认后使用短期、一次性的 `approvalToken` 安装；它绑定来源、包版本、归档与内容摘要及此前安装状态，不能复用。已安装插件的更新会走替换，保留当前启用状态，不再要求先手动禁用。来源、文件或安装状态变化后，需要重新检查与确认。
3. **故障处理**：启动、停止或故障状态仍可禁用。市场离线不阻断本地控制；来源错误或过期缓存会标明，不生成演示账号、插件或评分。

CLI、临时开发根目录、打包与检查命令见[开发指南](<development.md>)。恢复时可使用安全模式，并将示例 ID 换成实际插件 ID：

```sh
gonavi plugin --safe-mode list
gonavi plugin --safe-mode disable publisher.name
```

安全模式保留检查、安装、禁用和移除，拒绝启用与调用。`GONAVI_DISABLE_PLUGINS=1` 会强制进入安全模式，`--safe-mode=false` 不能覆盖。CLI 调用目前没有跨进程代理：同一根目录已有桌面执行所有者时，应在桌面内操作，或先关闭该执行所有者；不要把超时后的重试当作写操作回滚。

## 已实现的范围

| 领域 | 本阶段实现 |
|---|---|
| 后端运行时 | 独立子进程、异步启动、心跳、请求取消、有界通信、持久化启停意图与故障隔离。禁用先撤销贡献与调用，再限时清理并终止进程树；generation 检查拒绝旧实例结果，不循环自动重启。 |
| 插件 UI | 主窗口默认渲染有界声明式面板；声明 `ui.html-panel` 后可用不透明源沙箱 iframe 渲染有界自定义 HTML（无宿主桥接，CSP 拦截页面网络与外部资源）；需要完整桌面能力时仍走独立 Wails 进程与 WebView 配置目录。真实桌面渲染仍需平台验收。 |
| 安装与管理 | 本地目录、ZIP、TGZ 和市场安装；静态检查不执行插件。内容摘要绑定信任确认，市场使用实际归档预览与一次性批准，安装后保留来源记录。已安装插件可用「替换」保留启用状态地换包（CLI `replace`、桌面确认框自动识别），失败时保留原包。 |
| SDK 与示例 | 不依赖宿主 internal 包的独立 Go 模块、TypeScript 类型与协议 helper；真实 hello 插件、打包工具和崩溃／挂起／忽略取消／输出洪泛夹具。 |
| 数据源 | `data.sources` 声明接入真实连接、查询、元数据与取消路径，支持 mysql／postgres／sqlite 方言标签。默认协议 v1 只读；显式 `readOnly:false` 后协议 v2 支持单条写入与插件自管理事务。缺失、禁用或过期实例不能回退为内置驱动；批量执行与通用传输仍不支持。见[数据源指南](<data-sources.md>)。 |
| Packaged Skills | 显式 `ai.skills` 权限、静态包或原生包内的声明文档、只读预览及 Agent 加载工具。正文与同次包摘要校验绑定，读取前后检查 generation；不自动注入系统提示，不授权其他工具，不执行脚本或链接。仅支持工具调用的自定义 Agent 提供方使用技能工具；内置小模型白名单不变。见[Skills 指南](<skills.md>)。 |
| AI Provider | 显式 `ai.providers`、静态模型声明、独立 Go／TypeScript 流式 SDK、真实 HTTP/SSE 示例、设置入口及桌面／CLI Agent 冻结绑定。支持增量文本、推理、完整工具调用、usage 与有界图像输入；只投影选中的凭据，不回退提供方、不重放未知结果。v1 仍不含不透明上游会话状态。见[提供方指南](<ai-providers.md>)。 |
| 物化结果导出 | 显式 `data.export`、静态格式声明和一次有界渲染。仅查询结果里已经物化的选中行或当前页；宿主选文件、写临时文件并原子提交。插件看不到路径、连接或未选列。不重查数据库，不覆盖应用存储，也不把替换阶段的未知结果当成已回滚。见[导出指南](<exporters.md>)、[导出契约](<exporter-contract.md>)和[Typed NDJSON 示例](<../../examples/plugins/ndjson-exporter/main.go>)。 |
| Agent 工具 | 仅显式声明 `ai.tools` 的插件暴露普通命令；数据源、AI Provider 与导出保留命令不进入目录，也不能经通用 UI／窗口调用。所有工具使用 `side_effect_unknown`，沿用审批；描述符冻结包摘要和 generation，执行时再次核对，不自动重放结果不明的调用。只读 Agent 命令和描述符查询不启动插件。 |
| 共享市场服务 | PostgreSQL 仓储与迁移、逐版本审核及审计、不可替换的已发布产物、官方优先排序、真实评分的增改删与聚合、GitHub OAuth／设备授权、文件系统与 S3 兼容存储适配器。服务实现不等于已完成实库、外部服务或生产部署验收。 |

## 官方源、信任与部署边界

官方源由发布方控制的 `app.pluginOfficialMarketURL` 指定，**默认未配置**；配置位置见[官方源初始化](<../../internal/app/plugin_market_runtime.go#L15-L17>)。用户切换到自定义市场，不会让该市场自报的 `official:true` 获得官方身份。服务端的官方标记也来自受控发布者记录，不来自插件作者自行填写的清单。

本次没有部署生产服务，也没有创建或编造生产账号、目录与评分。市场服务独立于桌面进程部署；数据库、OAuth 应用、存储和管理员角色都需由运营方配置。操作步骤及权限要求见[市场部署说明](<../../deploy/plugin-market/README.md>)和[发布／审核 API](<../../deploy/plugin-market/admin-api.md>)。当前只有应用内市场、必要的登录／授权页和运营 API，**不是完整公共市场网站**。

插件仍是受信任的第三方代码。进程隔离、受限桥接和数据限额用于可靠性控制，**不构成 OS 安全沙箱，也不保证 CPU／内存等 OS 级硬配额**。原生插件可能使用当前账号的文件与网络权限；审核、权限清单和摘要校验不能证明代码安全。

## 2026-10-21 复跑

本节只记 2026-10-21 会话中**实际执行**的结果，与下面更早的快照分开。

| 检查范围 | 结果 |
|---|---|
| 前端生产构建 | `npm run build` 通过：`tsc` → vite → 独立窗口 IIFE，528 个文件 → 4.62 MB |
| 插件前端切片 | `src/plugins` **45 文件 / 285 测试**通过；`src/i18n` + `pluginManager` 一并跑过 **62 文件 / 376 测试** |
| 前端全量 | 整轮并发下 5 个文件超时（`ConnectionModal.performance`、`MonacoEditor.language-highlight`、`QueryEditor.external-sql-save.ai-prompts-and-providers`、`ConnectionModalKafkaAuth`、`UserManagementWorkbench`）；这 5 个成组单跑 **43 项全过**，属负载敏感而非缺陷 |
| TypeScript 类型检查 | `frontend` 全量 `tsc --noEmit` 干净；`sdk/typescript` 自身 `tsc -p` 与 `--strict` 单文件检查均干净 |
| TypeScript SDK | 30 文件 / **277 测试**通过（含新增导出契约测试） |
| Go SDK 与示例 | `sdk/go` 全量 3.278s；`examples/plugins` 7 个包全通过 |
| Go 宿主插件包 | `internal/plugin` 全量 95.581s；`internal/market` 全量 34.168s |
| CLI 与桌面 | `internal/cli -run Plugin` 23.016s；`internal/app -run Plugin` 62.124s |
| 平台敏感（Windows 半边） | 按 CI 同样用例本机复跑通过：pluginmarket 3.041s、nativewindow 20.861s、db／mcpserver／dataexport 的 `-run ^TestPlugin`、ai/service 与 ai/provider 指定用例、jvm 三项往返 25.445s（本机 Java 21） |
| 编译 | `go build ./...` 干净 |
| 新增契约测试 | SDK 导出与类型、JSON-RPC 方法表、权限双向、前端权限标签、插件文档链接、换行风格、失败码映射、安装/替换选择——均带反向验证 |
| PostgreSQL 16 契约 | 用 Docker 起一次性 `postgres:16`（16.15，映射到本机 55432，未触碰本机 PG18 实例）。`internal/market` 的 5 个 PG 集成用例真实执行并通过（`TestPostgresReviewedCatalogAndRatingTransactions`、`TestPostgresDeviceSingleConsumptionAndExplicitRoles`、`TestPostgresSemverCompatibilityMatchesGo`、`TestPostgresPublicationRollsBackWhenAuditFails`、`TestPostgresTargetGuardRejectsEffectiveOverrides` 含 8 个子用例）；整组 `internal/plugin` + `internal/pluginmarket` + `internal/market` 97.672s／3.547s／38.831s |

仍未执行：`-race`（本机 `CGO_ENABLED=0` 且无 gcc／clang／cl，无法本地编译 race 检测器；CI 的 marketplace-contract 作业仍在 Linux 上跑 `-race`）、Linux／macOS 平台作业，以及真实 Wails 渲染与真实 GitHub／S3 联调。PostgreSQL 16 已不再属于未执行项。

## 更早的验证快照

以下为更早一轮已取得的测试结果；未验证项单独列出，不以局部通过代替全量验收。

| 检查范围 | 当前结果 |
|---|---|
| 前端构建 | 最终复制配置修复后的 `npm run build` 通过，包含独立窗口 IIFE；524 个文件打包为 4.61 MB 压缩产物（构建工具报告）。此前被主动取消的旧快照构建不计入最终成功。 |
| UI 自动化 | AI Provider 与共享数据源／Skills／AI 设置矩阵 **488 项／30 文件**通过（maxWorkers≤4）；最后复制配置修复另跑 **139 项／6 文件**和串行全 TypeScript 检查通过，数量不叠加。包括旧 75 项异步交互、真实 wrapper／catalog 生命周期、显式清空 headers、严格身份、未知上下文限额及内置提供方兼容。44 个新增 key 已同步六语言。 |
| SDK 与示例 | Go SDK 完整测试重复 3 次与 vet 通过；TypeScript SDK 类型检查和 **225 项测试**通过。独立 HTTP/SSE 原生示例重复 2 次及 vet、全 examples 回归通过；静态打包明确拒绝 AI Provider 声明，原有 Skills／数据源兼容回归通过。 |
| Go 相关包 | Provider 最终 runtime 全量 **64.218s**、市场／服务端全量、SDK／examples 全量及共享语言包通过；相关宿主／驱动／插件包汇总 vet 通过。此前只读数据源／Skills 阶段的 DB、pluginmarket 与 nativewindow 全量已通过。 |
| App／Web／主入口 | Provider 最终修复快照的 **App、MCP、Web、CLI 与主入口全量包测试通过**：App 500.022s，MCP 29.232s，Web 34.861s，CLI 32.833s，主入口 18.646s。AI Service 仅在显式排除下述 2 个已独立复现的 Windows 不兼容用例后通过（179.158s），不记为未筛选全量通过。 |
| Provider 真流与故障边界 | 独立 SDK 子进程＋本地 HTTP/SSE 覆盖首块先到、reasoning／完整工具调用／usage、取消到上游、异常 EOF、503 不重放、冻结凭据与代次。16 路持续空轮询保持原 5 秒调用预算，公平排队修复后由作者和独立审查者各重复 3 次通过。 |
| CLI | 完整 `internal/cli` 测试套件通过。此前两处 Windows 测试夹具已修复：关闭临时日志、为测试文件设置私有 DACL；生产权限校验器未放宽。 |

回归中修复了测试夹具的日志关闭、私有 DACL、全局代理状态恢复和 Windows 8.3／长路径一致性；没有放宽生产权限、代理策略或快捷方式目标检查。

IPC 计时测试不再假定快路径耗时必须大于零：[确定性时钟测试](<../../internal/app/ipc_profile_clock_test.go>)校验精确计时、零值、亚微秒舍入及编码失败清零；相关测试连续 50 次通过，生产环境仍使用真实时钟，不伪造最小耗时。

数据源独立复核发现并修复两项 P2：SQL 执行分类未使用声明方言、旧元数据缓存跨 generation 复用。本阶段插件元数据明确绕过旧结果缓存与合并请求，内置缓存不变；公开 API 回归覆盖单条、取消式、Multi、CLI、禁用及重新启用。

Skills 独立复核已关闭全部发现：静态打包 FIFO 打开竞态、前后端路径语法差异、可选目录超时／取消污染普通工具，以及 Windows 根路径规范化。资源清理测试改为目标文件独占打开探针并带正向校准，不再用进程中无关线程／Event 的句柄增减判定文件泄漏；三个独立进程复跑通过。

Provider 最终独立审查无遗留发现；最后 UI 保存／复制与生命周期 139 项独立复跑通过，审查者未修改源码。Lead 的新生产源预算审计覆盖 213 个 Go 文件／1,054 个函数体和 110 个 TypeScript 文件／652 个函数体，均满足限额，受保护前端根文件没有改动。

Provider 回归还修复了取消队列饱和、排队与真正执行超时混用、调用方退出后丢失未结算回复 watchdog、缓存批次的依赖撤销窗口，以及完整 RPC envelope 限额。凭据回归覆盖 nil／空／非空 headers、大小写显式覆盖、空 ID 草稿不查询其他记录的 secret，以及复制时不复活已删公开 headers、保留合法 header-only 认证；界面不会把插件身份、模型或未知上下文限额改写为内置提供方。

物化导出这一轮已复跑：导出域插件测试 19.206s，宿主 `TestPluginExport` 28.374s，`internal/app`、`internal/dataexport`、`internal/plugin` 的 vet 通过。Go SDK、Typed NDJSON 示例和静态打包测试通过。前端导出契约 67 项通过，全量 TypeScript 检查通过。Windows 上指向应用存储子目录的 junction 会被拒绝；跨卷普通目标不会被误拒。完整 `internal/dataexport` 仍有既有 Parquet 测试要求 Unix `0600`，单独复现后未修改。公开使用指南已补齐。独立审查没有新的可复现缺陷：宿主导出相关测试 31.147s，导出域插件测试 17.399s 且 vet 通过，运行时导出测试重复 3 次共 39.752s。TypeScript SDK 在 131072 个逻辑节点时接受、131073 个时拒绝。

**尚未完成的验证：**

- 未筛选 AI Service 全量仍有 2 个未修改的 Windows 用例失败：[权限位断言](<../../internal/ai/service/auto_approval_store_test.go#L69-L75>)要求 POSIX `0600`，[CLI 缓存断言](<../../internal/ai/service/local_cli_detection_cache_test.go#L26-L29>)要求 Unix 路径分隔符；不带新插件测试的独立复跑仍失败。最终命令仅用 `-skip` 排除这两项，不能据此宣称完整原始套件通过。完整 Provider 包另有既有 CLI 的 NVM／Unix 路径、中文 Bash 脚本路径和文件权限断言失败，代表用例也已单独复现；本轮保留这些失败，未放宽原断言。
- 本次前端范围的 i18n 扫描为 0 项；全库扫描仍报告 1,616 项，未作为全库通过处理，也未在本轮扩展修复范围。
- 本地 4 项真实 PostgreSQL 测试跳过；fake repository／HTTP 测试不能证明真实迁移与事务已经执行。
- 本地 `CGO_ENABLED=0` 且无可用 C 编译器，未运行 `-race`。当前 Windows 的 `bash` 只是未安装 Linux 发行版的 WSL 入口，相关 macOS 更新脚本的 Bash 语法测试按明确的运行时前置条件跳过；其他驱动／平台测试也可能按环境条件跳过。
- 相关 Go 包、App、CLI 与主入口的汇总 `go vet` 已通过。检查中去掉了 [XLSX 往返测试:155–157](<../../internal/app/xlsx_export_roundtrip_test.go#L155-L157>)交换表达式中两项冗余自赋值，保留原有测试行为；没有关闭静态检查或放宽生产校验。
- [后端 CI](<../../.github/workflows/backend-tests.yml>) 已加入 PostgreSQL 16／`-race` 必须通过的契约任务、数据源及 AI Provider 竞态测试、macOS／Windows 插件宿主测试，以及数据源／Skills／AI Provider 前端契约测试；**本轮尚未执行这些 CI 任务**，不能记作通过。
- Skills 的 Unix FIFO／no-follow 测试已交叉编译，但本机没有执行 Unix 文件系统回归；Windows 的真实 junction／symlink／长路径用例已执行。
- 故障恢复已在**管理器层**覆盖：[manager_recovery_test.go](<../../internal/plugin/manager_recovery_test.go>)安装会崩溃的夹具 → 进入 `faulted` → 禁用 → 换装可用包（摘要改变）→ 重新启用后到达 `running`、generation 不复用、`echo` 调用返回预期结果 → 再次禁用。`internal/plugin` 全量 99.981s 通过。桌面 Wails 渲染仍未验证。
- 平台敏感矩阵的 **Windows 半边**已按 CI 同样的用例在本机复跑并通过：`internal/plugin` 全量、`internal/pluginmarket` 3.041s、`internal/nativewindow` 20.861s、`internal/app -run Plugin` 67.569s、`internal/cli -run Plugin` 23.716s、`internal/market` 全量、`internal/db`／`internal/mcpserver`／`internal/dataexport` 的 `-run ^TestPlugin` 分别为 7.657s／21.828s／20.141s、`internal/ai/service` 与 `internal/ai/provider` 的 CI 指定用例、`internal/jvm` 三项真实往返 25.445s（本机 Java 21，CI 为 17），以及 `internal/db` 的驱动代理清理用例。Linux／macOS 半边、PostgreSQL 16 与 `-race` 仍未在本机执行。
- AI Provider 的真实验证使用本地 HTTP/SSE 上游与独立原生子进程；未调用付费／生产模型，不证明任何账号、线上模型或网关可用。真实 Wails 窗口渲染、真实 GitHub 登录授权、S3／MinIO 联调、TLS／代理与实际部署尚未验证。S3 当前是有界单对象适配器，不是完整 S3 SDK；具体限制见[存储说明](<../../deploy/plugin-market/README.md#s3-compatible-storage>)。

本轮没有 commit、push 或生产操作。复跑方法见[本地开发验证](<development.md#local-verification>)和[市场服务验证](<../../deploy/plugin-market/README.md#verification>)。

## 下一阶段清单

- [x] PostgreSQL 16 契约：本机用 Docker 起一次性 `postgres:16` 跑通 `internal/market` 的 5 个 PG 集成用例（未触碰本机 PG18）。
- [ ] 仍需 `-race`（本机 `CGO_ENABLED=0` 且无 C 编译器，只能在 Linux CI 跑）、Linux／macOS 平台作业、真实 Wails 渲染与真实 GitHub／S3 联调；Windows 侧平台敏感用例已在本机复跑并记录，故障恢复已在管理器层覆盖。
- [ ] 在隔离预发布环境验证 GitHub 授权、数据库迁移／事务、S3 或 MinIO 条件写入与不可变存储、TLS／代理；随后决定正式源配置与运维方案。
- [x] 接通只读 SQL 数据源 Adapter、双语言 SDK、实际示例、连接选择器和保护策略；数据源内部命令仅供宿主专用入口调用。
- [ ] 扩展数据源写入、事务、流式结果、更多数据模型及安全传输；必须重新设计未知写入结果、会话关闭与 runtime 退出顺序。
- [x] 提供包内 Skills 元数据发现、显式预览与 Agent 工具加载、静态／原生混合打包和市场校验；不自动注入或撤回历史文本。
- [x] 接通原生 AI Provider 的文本／推理／完整工具调用流、静态模型目录、独立双语言 SDK、真实本地 HTTP/SSE 回归与设置／Agent／CLI 路由。
- [x] 支持声明式图像输入：仅用户消息、base64 `data:` URL、每消息 4 张／单图 4 MiB／单请求 24 MiB，图像请求帧上限 32 MiB；未声明提供方继续拒绝图片。
- [x] 接通查询结果物化快照导出：选中行／当前页、冻结 pin、有界 Tagged Cell、宿主原子提交，以及 Typed NDJSON 示例。表导出、全量重查和 CLI 导出模式不在此范围内。
- [x] 接通调用方绑定的 `host.log` 和 `host.describe`：只返回当前进程身份或写有界诊断。它们不是通用宿主 API。
- [x] 接通运行状态的一次性 `plugin.lifecycle` 通知。它不阻塞启用或禁用；停用仍走现有 shutdown，不额外等待回调。
- [ ] 扩展不透明上游会话与动态模型发现；继续实现其余宿主能力。技能可以声明最多 4 个配套 `.md`。安装、市场和静态打包会校验并复制它们；桌面预览只显式读取清单中的一个文件。Agent 不加载、不注入，Web 管理通道默认只读，服务器显式开启后可读取。脚本与工具授权仍未实现。
- [ ] 补 Git／npm 安装、插件组合包（bundles）、多实例和开发热重载；现有 SDK 不代表这些功能已提供。
- [x] 让**市场更新**对已启用插件直接走替换：已安装插件的更新保留启用状态，不再要求先禁用。选择逻辑抽成 `installMarketPackage`，不再依赖难以复现的多版本市场夹具来验证。
- [x] 实现经鉴权且显式启用的 Web 管理通道：默认只读，服务器设置 `GONAVI_WEB_PLUGIN_MANAGEMENT=1` 后放开安装、启停、替换、移除与技能文档读取；原生文件选择器与独立插件窗口仍仅桌面端可用。
- [ ] 建设完整公共市场网站；当前登录／授权页不能替代发布者与用户网站。

## 文档导航

- [开发、打包、CLI 与故障夹具](<development.md>)
- [Go／TypeScript SDK 与 UI 桥接](<sdk.md>)
- [JSON-RPC 协议与包摘要](<protocol.md>)
- [数据源开发与实际示例](<data-sources.md>)
- [Skills 声明、静态打包与显式加载](<skills.md>)
- [AI Provider 声明、真实流与独立 SDK](<ai-providers.md>)
- [查询结果物化快照导出](<exporters.md>)
- [有界宿主诊断 host.log](<host-log.md>)
- [当前进程身份 host.describe](<host-describe.md>)
- [运行状态生命周期通知](<lifecycle.md>)
- [显式启用的 Agent 工具](<ai-tools.md>)
- [权限参考](<permissions.md>)
- [常见故障排查](<troubleshooting.md>)
- [跨模块实现契约](<implementation-contract.md>)：协调依据，不是完整功能已交付的声明
- [市场服务部署与验证](<../../deploy/plugin-market/README.md>)、[运营 API](<../../deploy/plugin-market/admin-api.md>)
