# 常见故障排查

本页只覆盖已经能精确复现、且有明确处理方式的失败。没有把握的推测不写进来。

## 检查阶段就失败

`plugin check` / 桌面「检查」只做静态校验，不执行插件。常见原因：

| 报错 | 含义 | 处理 |
|---|---|---|
| `declared entry is not a regular package file; build the native binary and check the packaged output` | 检查的是**源目录**。源清单写的是 `backend.default`，成品清单才写 `backend.platforms` 并带编译产物。 | 先用打包工具生成成品，再对成品目录或归档做检查。见[开发指南](<development.md>)。 |
| `unknown manifest field "xxx"` | 清单里有多余字段。短且可打印的字段名会显示出来，长名或非 ASCII 名不显示。 | 对照 [SDK 类型](<sdk.md>)删掉多余字段。 |
| `invalid declared skill document: skill document is empty or exceeds size limit` | 技能正文为空、超过 64 KiB，或声明了不存在的入口。 | 确认 `SKILL.md` 存在且为非空 UTF-8，入口与配套合计各自不超过 64 KiB。 |
| `unsafe package path` / `reserved package path` | 包内路径含 `..`、绝对路径、禁止字符，或用了 Windows 保留名（`CON`、`COM1` 等）。 | 改用可移植的相对路径。 |

## 安装阶段失败

| 报错 | 含义 | 处理 |
|---|---|---|
| `disable plugin before replacing its package` | 直接安装到一个仍处于启用状态的插件上。 | 用 `replace`（CLI）或在桌面确认框里让系统自动识别为替换。 |
| `plugin_digest_mismatch`（信息为 `plugin package digest mismatch`） | 安装时的内容与检查时看到的不一致，包被改过。 | 重新检查并确认新的摘要。 |
| `plugin_disabled`（信息为 `plugin is not enabled and running`） | 目标插件未启用、被隔离、依赖缺失，或处于安全模式。 | 先看 `list` 里的状态与 `lastError`，再决定启用或修复依赖。 |
| `plugin_busy`（信息为 `plugin invocation capacity exhausted`） | 并发调用额度用尽。 | 等待在途调用结束；不要在超时后盲目重试写操作。 |

## 运行时问题

- **桌面和 CLI 抢同一个根目录**：CLI 调用需要独占运行时所有者。先关闭桌面对该根目录的执行所有者，或直接在桌面内操作。没有跨进程调用代理。
- **插件故障后怎么恢复**：故障状态仍可禁用。换掉有问题的包后再启用即可；管理器会在新代次上重新拉起，并拒绝旧代次的迟到结果。若替换失败，原包与启用意图都会保留。
- **安全模式**：`GONAVI_DISABLE_PLUGINS=1` 会强制进入安全模式，`--safe-mode=false` 不能覆盖。安全模式下仍可列表、检查、安装、禁用和移除，只有启用与调用被拒绝。
- **Web 运行时**：浏览器会话默认只读，也不读取技能配套文档。服务器显式设置 `GONAVI_WEB_PLUGIN_MANAGEMENT=1` 后，已认证会话可安装、启用、替换、移除插件并读取技能文档；原生文件选择器与独立插件窗口仍只在桌面端可用，本地安装需填写服务器上的路径。开启后任何已认证会话都能让服务器执行插件代码，请只在单一管理员、可信网络的场景使用。

## 仍然要自己确认的事

插件是受信任的第三方代码，进程隔离只保证界面不被拖死，不是 OS 安全沙箱，也没有 CPU／内存硬配额。审核、权限清单和摘要校验都不能证明代码安全。
