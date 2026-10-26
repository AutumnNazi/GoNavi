# 第三方插件作者指南

本文面向第一次为 GoNavi 开发并上架插件的第三方作者。目标是从零走完一条可复现路径：

**选择插件形态 → 实现 → 本地打包/检查 → 发布到 GitHub → 从 Release 发布到市场 → 安装验收 → 发布更新。**

完整实现边界以 [SDK](<sdk.md>)、[协议](<protocol.md>) 和[权限参考](<permissions.md>)为准。本文负责告诉你“先做什么、看哪一篇、怎样算完成”，不替代那些契约。

## 0. 先建立正确的安全预期

插件是**受信任的第三方原生代码**，以当前操作系统用户的权限运行。进程隔离、权限预览和市场静态检查保护的是宿主响应性与发布一致性，不是 OS 沙箱，也不提供 CPU／内存硬配额。

- 市场检查不会执行插件；安装时的真实包检查同样不会执行插件。
- manifest 里的 `author`、`name` 和自报字段都不构成官方身份。
- 官方徽标只由市场运营方授予，第三方作者不能自行声明。
- 发布后的版本字节不可替换；修复问题必须提升语义版本并发布新版本。

## 1. 决定插件是什么

一个插件包可以声明一种或多种贡献。先选最小可用形态，不要为了“功能多”一次性接入全部能力。

| 你想提供的能力 | 推荐文档 | 典型入口 |
|---|---|---|
| 可调用命令 / 宿主渲染面板 | [开发指南](<development.md>)、[SDK](<sdk.md>) | 自定义窗口、声明式面板 |
| 完整插件页面并挂到标题栏菜单 | [页面契约](<pages.md>) | `pages` / `navigation` |
| Agent 可调用的普通命令 | [Agent 工具](<ai-tools.md>) | `ai.tools` |
| 打包技能文档 | [Skills](<skills.md>) | `ai.skills` |
| SQL 数据源 | [数据源](<data-sources.md>) | `data.sources` |
| 查询结果导出格式 | [导出器](<exporters.md>) | `data.export` |
| LLM 供应商 | [AI Provider](<ai-providers.md>) | `ai.providers` |

官方插件统一放在 `Syngnat/GoNavi-Plugin-Market` monorepo；第三方作者可以一仓一插件，也可以一仓多插件。无论哪种，市场最终校验和分发的是**构建好的归档**，不是源码目录。

## 2. 从最小 hello 插件开始

先运行真实示例，再替换成自己的身份。示例源码：

- [hello/main.go](<../../examples/plugins/hello/main.go>)
- [hello/gonavi.plugin.json](<../../examples/plugins/hello/gonavi.plugin.json>)
- [示例打包器](<../../examples/plugins/package/main.go>)

开发期使用一次性目录，避免污染日常插件库：

```sh
work=$(mktemp -d)
package="$work/plugin-package"
root="$work/plugin-store"

# 在主仓库根目录运行；输出目录必须不存在
go -C examples/plugins run ./package \
  -source ./hello \
  -manifest ./hello/gonavi.plugin.json \
  -output "$package"
```

实现插件时至少要做到：

1. 从 `stdin/stdout` 使用 SDK 的 JSON 帧，不自行输出调试文本污染协议。
2. 传递并响应 `context.Context` 的取消，不在退出时遗留不受控 goroutine/子进程。
3. 对参数做上限校验，错误返回稳定、安全的错误码，不回显凭据或上游原始报文。
4. 不在插件启动时读取无关宿主配置；只使用用户或宿主显式投影给该次调用的数据。

## 3. 写清单：身份、版本、平台与权限

最终包根目录必须直接包含 `gonavi.plugin.json`（不能再套一层目录）。最小字段：

```json
{
  "schemaVersion": 1,
  "apiVersion": 1,
  "id": "gh-yourlogin.example",
  "name": "Example plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "author": "Your name",
  "license": "Apache-2.0",
  "permissions": [],
  "backend": {
    "platforms": {
      "darwin/arm64": {"executable": "bin/plugin", "runtime": "native"}
    }
  }
}
```

规则要点：

- `id` 必须小写、以发布者命名空间加英文句点开头。第三方 GitHub 登录后通常是 `gh-<github-login>.*`，以“我的插件”页实际显示为准。
- `version` 必须是严格语义版本；上架后的同版本不能替换。修 bug 也要提升版本。
- 成品清单使用 `backend.platforms`；源码模板里的 `backend.default` 会由打包器转成实际平台条目。
- 只声明你实际实现的贡献与权限。`permissionNotes` 只是说明，不会授予权限。
- 清单和包内路径都拒绝绝对路径、`..`、Windows 保留名和链接技巧。

完整字段以 [SDK 类型](<sdk.md>) 和[协议清单](<protocol.md#manifest-and-package-identity>)为准。

## 4. 本地检查、安装和真实调用

永远检查打包产物，不要检查源码树：

```sh
gonavi plugin --root "$root" check "$package"
gonavi plugin --root "$root" inspect "$package"
gonavi plugin --root "$root" install \
  --digest "<inspect 返回的 digest>" --trust "$package"
gonavi plugin --root "$root" list
gonavi plugin --root "$root" enable gh-yourlogin.example
gonavi plugin --root "$root" invoke --args '{"name":"author"}' \
  gh-yourlogin.example hello
```

“enable 成功”只代表启用意图已持久化，不代表插件已经完全启动。查看 `list` 的 `state`、`generation` 和 `lastError`；失败后仍可禁用、替换和移除。

CLI 调用需要独占本地运行时所有者。如果桌面端正打开同一数据根，先在桌面内操作，或关闭桌面的插件执行所有者；当前没有跨进程调用代理。

## 5. 生成可分发的 ZIP

发布包需要把**构建产物**放在 ZIP/TGZ 根目录，至少包含：

```text
gonavi.plugin.json
bin/<每个平台声明的可执行文件名>
icons/<清单声明的品牌图标>
LICENSE
```

实际文件名和相对路径必须与 `backend.platforms`、`contributes` 和 `window` 中的声明逐项一致。示例打包器单次构建一个平台；发布多平台包时，需要分别构建并把各平台产物放进同一个归档。不要打包：

- `.git`、构建缓存、测试数据库、密钥、口令和本地配置；
- 绝对路径、符号链接/硬链接、设备文件和跨目录路径；
- 只有当前机器需要的临时调试文件。

建议对每个平台实际构建并在本地至少检查一次。归档上限当前为 64 MiB；清单、单个文件和总展开大小另有限制，详见[开发指南](<development.md#archives-and-distribution>)。

发布前最后一次检查：

```sh
gonavi plugin --root "$root" check ./your-plugin.zip
shasum -a 256 ./your-plugin.zip   # macOS/Linux
# certutil -hashfile .\your-plugin.zip SHA256   # Windows PowerShell
```

## 6. 把成品发布到 GitHub Release

第三方作者有两种仓库组织方式：

### 单插件仓库（推荐给第一次发布）

仓库只放一个插件。创建稳定 Release 时附带**一个** ZIP/TGZ 资产：

```sh
gh release create v1.0.0 ./your-plugin.zip \
  --title "v1.0.0" \
  --notes "First marketplace release"
```

之后在网站 `/publish` 只填：

```text
https://github.com/your-github-login/your-plugin-repo
```

市场读取该仓库 latest stable Release，检查唯一归档并显示摘要。单插件仓库发布成功后，该仓库会登记为后续自动更新来源。

### 一仓多插件（monorepo）

仓库里有多个插件时，**不能只填仓库根链接**。每次发布必须指定具体 Release/Tag，让市场知道这次发布的是哪个 ZIP：

```text
https://github.com/your-github-login/your-plugins/releases/tag/plugin-a-v1.0.0
```

官方 `Syngnat/GoNavi-Plugin-Market` 就是这种模式。市场会明确拒绝该仓库的根链接，并要求具体 Release/Tag，避免 latest Release 被另一个插件占用。

发布 Release 的原则：

- 使用稳定、非 draft 的 Release；单插件仓库的 latest stable Release 才会被读取。
- 一个 Release 中给本插件一个明确的 ZIP/TGZ 资产，不要让市场猜文件。
- Tag 名可以自由命名，但包内 `version` 才是版本判断依据；发布新版本时两者都提升。
- 不把源码 ZIP 当成插件包；源码 ZIP 根目录通常没有成品 `gonavi.plugin.json` 和平台二进制。

## 7. 在市场网站发布

1. 打开 <https://plugin.gonavi.org/publish>，用 GitHub 登录。
2. 确认“我的插件”页显示的发布者命名空间，清单 `id` 必须以它开头。
3. 默认选择 **GitHub Release（推荐）**，粘贴仓库根或具体 Release 链接。
4. 等待预检，核对插件 ID、版本、平台、权限、归档 SHA-256 和 Release 标签。
5. 勾选确认并发布。通过静态校验后即上架，不需要等待人工审核；官方徽标仍由运营单独授予。

如果 Release 暂时不可用、仓库是私有的，或你手里只有离线包，再使用“手动上传兜底”：上传 ZIP/TGZ，完成同样的预检与确认流程。

## 8. 安装验收：不要只看到“已上架”

发布成功后至少完成一次真实安装：

1. 打开另一台或干净数据目录的 GoNavi。
2. 在市场搜索刚发布的插件，打开详情并安装。
3. 确认预览中的 manifest、权限、版本和 SHA-256 与发布包一致。
4. 启用插件，实际触发它的命令、页面、数据源或 AI Provider 调用。
5. 回到市场确认公开详情、下载与账号页的发布记录一致。

桌面端的市场安装是匿名只读的；发布动作只在网站完成。安装、检查、启用和执行是不同阶段，不能因为“下载成功”就宣称“插件可用”。

## 9. 发版与更新

修改代码后：

1. 提升 manifest 的 `version`；
2. 重新打包所有声明的平台；
3. 本地 `check`/`inspect`；
4. 创建新 GitHub Release（单插件仓库可继续复用自动同步来源）；
5. 网站重新预检并确认上架，或等待已登记来源的定时同步。

已发布版本永久不可覆盖。若新版本被拒绝或需要撤回，旧版本不会自动复活；下架/重新发布按市场运营规则处理。

## 10. 发布前检查清单

- [ ] `gonavi.plugin.json` 在压缩包根目录，字段与 SDK 类型一致。
- [ ] `id` 使用当前发布者命名空间，`version` 已提升且符合 semver。
- [ ] 每个声明的平台都包含可用二进制，路径为包内相对路径。
- [ ] 未打包 `.git`、密钥、本地配置、缓存和测试数据库。
- [ ] 本地 `gonavi plugin check` 通过，`inspect` 的摘要已记录。
- [ ] 权限最小化；`permissionNotes` 只解释，不冒充授权。
- [ ] GitHub Release 中只有一个明确的插件归档；monorepo 使用具体 Tag/Release 链接。
- [ ] 网站预检显示的 ID、版本、平台、权限和 SHA-256 与本地一致。
- [ ] 已在干净环境安装、启用并实际调用一次。
- [ ] 已确认公开详情与账号页发布记录可访问。

更具体的错误处理见 [FAQ](<faq.md>) 和[故障排查](<troubleshooting.md>)。
