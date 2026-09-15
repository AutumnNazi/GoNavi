# GoNavi 编码规约

本文件是 GoNavi 的**规约索引与跨语言硬约束**。Cursor、Claude Code、Codex 及其他能读取仓库提示词的 AI 都必须遵守。语言专属手册以链接为准，不要另写一套。

配套入口：

- `CLAUDE.md` → Claude Code
- `.cursor/rules/*.mdc` → Cursor（按文件类型自动附加）
- 本文件 → Codex / Cursor / 通用 Agent
- [`GO_STYLE.md`](./GO_STYLE.md) → **Go 专属手册**（改 `*.go` 时必读）
- [`GO_STYLE.md`](./GO_STYLE.md) → **Go 专属手册**（改 `*.go` 时必读）

标记含义与《阿里巴巴 Java 开发手册》一致：**【强制】** 必须执行，**【推荐】** 默认执行，**【参考】** 有充分理由才可偏离。

---

## 0. 项目是什么

GoNavi 是 **Wails v2 + Go + React 18** 的跨平台数据源工作台，不是 Electron 应用，也不是普通前后端分离 Web。

| 层 | 位置 | 职责 |
|---|---|---|
| 桌面壳 | `main.go` | Wails 启动、窗口、菜单 |
| Wails 绑定 | `internal/app` | 给前端/MCP/Web RPC 的 `App` 方法，保持薄 |
| 领域实现 | `internal/db`、`internal/ai`、`internal/sync`、`internal/connection` 等 | 驱动、AI、同步、类型 |
| UI | `frontend/src` | React + Ant Design 5 + Zustand + Monaco |
| 文案 | `shared/i18n/*.json` | 前后端共用目录 |
| 生成物 | `frontend/wailsjs/` | **禁止手改** |
| Go 手册 | [`GO_STYLE.md`](./GO_STYLE.md) | **Go 专属规约**（Uber + Google + Effective Go + 本仓库） |
| Java | `tools/jmx-helper`、`internal/jvm/testdata` | 小工具/夹具，跟《阿里巴巴 Java 开发手册》 |

Go module：`GoNavi-Wails`。默认集成分支：`dev`。

---

## 1. 【强制】体积与拆分（本仓库最高优先级）

当前债务（禁止继续加行）：`frontend/src/components/QueryEditor.tsx`、`App.tsx`、`store.ts`、`DataGrid.tsx`、`Sidebar.tsx`、`queryEditor/QueryEditorHelpers.ts`、`internal/app/methods_file.go`、`methods_db.go`、`app.go`。

正确范例：`DataGridShell` / `DataGridCore` / `DataGridModals` 拆文件；`components/queryEditor/`、`components/sidebar/`、`components/ai/` 拆目录；Go 侧 `methods_db_objects.go`、`methods_db_transaction.go`、`application_icon_windows.go`。

### 1.1 限额

| 对象 | 【强制】上限 | 【推荐】 |
|---|---|---|
| 新建生产源文件 | 800 行 | 400 行 |
| 存量超标文件 | **禁止净增加行数** | 每次改动都拆走一块 |
| 函数 / 组件函数体 | 120 行 | 80 行 |
| 测试文件 | 1500 行 | 按场景拆成多个 `*.test.ts(x)` / `*_test.go` |
| `frontend/wailsjs/**` | 0 行手改 | 走 Wails 生成 |

### 1.2 拆分原则

1. **能拆包拆包，能拆类拆类，能拆 hook 拆 hook。** 不要用「先写在一个文件里以后再拆」作为默认。
2. 一个文件只承担一个主题：一种驱动能力、一种 UI 面板、一组绑定方法、一个 hook。
3. 触碰超标文件时，必须把本次改动抽到新文件；允许的最小动作是「新逻辑写在新文件，旧文件只留 re-export / 接线」。
4. 禁止为了过限额做无意义换行、把逻辑藏进巨型字符串、或把测试和实现揉进同一生产文件。

```text
❌ QueryEditor.tsx 再加 200 行执行逻辑
✅ queryEditor/queryEditorExecution.ts + 单测，QueryEditor.tsx 只调用

❌ methods_file.go 继续堆导入/导出
✅ methods_file_import.go / methods_file_export.go，App 方法签名不变

❌ store.ts 再加一块持久化状态
✅ store/aiChatSlice.ts（或等价拆分），根 store 只组合
```

---

## 2. 【强制】分层与依赖

1. `internal/app` 的 `App` 方法只做：参数校验、鉴权/只读策略、调领域包、把结果收成 `connection.QueryResult`。禁止在绑定层写驱动 SQL、解析协议、渲染逻辑。
2. 驱动实现放 `internal/db/*_impl.go`。公共契约是 `db.Database`；驱动特有能力用**可选接口**扩展（参考 `TableExistsChecker`、`ElasticsearchConsoleExecutor`），不要把所有方法塞进 `Database`。
3. 前端通过 `frontend/wailsjs/go/app/App` 调绑定；共享类型优先用 `frontend/src/types.ts` 与 `internal/connection`，保持 JSON 字段兼容。
4. 禁止 UI 直接拼驱动方言细节的复制粘贴；抽到 `frontend/src/utils/` 或已有 `queryEditor/`、`sidebar/` helper。
5. 禁止引入 Electron、新的状态库、新的 UI 库，除非任务明确要求。默认：React 函数组件、antd 5、Zustand、现有 `v2-theme-*.css`。
6. 平台差异用文件后缀：`*_windows.go`、`*_darwin.go`、`*_stub.go` / `*_nonwindows.go`，不要在同一函数里堆三大平台分支。

---

## 3. Go 规约

Java 跟《阿里巴巴 Java 开发手册》。**Go 不套那本手册**，专属正文是 [`GO_STYLE.md`](./GO_STYLE.md)（Uber Go Style Guide → Google Go Style / Code Review Comments → Effective Go，再叠加本仓库 Wails/驱动/i18n 条款）。改 `**/*.go` 时必须遵守该手册。

下面只列 GoNavi 叠加里最容易写错的几条；命名、并发、接口、切片、注释等以 `GO_STYLE.md` 为准。

**【强制】**

1. `internal/app` 绑定层返回 `connection.QueryResult`，失败：`Success: false` + i18n 后的 `Message`。领域层 `fmt.Errorf("...: %w", err)`，用 `errors.Is` / `errors.As`。
2. `context.Context` 第一参数，必须传到驱动查询/HTTP；连接超时 ≠ 查询超时。
3. `db.Database` 保持小，特有能力用可选接口。禁止在 `internal/app`、`internal/db` 里 `panic`。
4. 日志走 `internal/logger`，禁止密码/DSN。用户可见文案走 `shared/i18n`。
5. 文件：`methods_<领域>.go`、`<引擎>_impl.go`、`<主题>_<平台>.go`。禁止继续膨胀 `methods_file.go` / `methods_db.go` / `app.go`。
6. 单测：同包 `xxx_test.go`，表驱动，不连生产库。

---

## 4. React / TypeScript 规约

**【强制】**

1. 只用函数组件。可复用状态与副作用抽 `useXxx` hook；可复用纯函数抽 `frontend/src/utils/` 或特性目录（如 `components/queryEditor/`）。
2. 组件文件：一个主组件。子面板、toolbar、modal、layout 计算各自成文件。参考 `QueryEditorToolbar.tsx`、`queryEditorMonacoLayout.ts`，不要把它们写回 `QueryEditor.tsx`。
3. 用户可见字符串必须 `t('catalog.key')` / `useI18n()`。禁止 JSX 里写死中文/英文（单测断言、正则、品牌名除外）。目录是 `shared/i18n/*.json`，键名 `domain.feature.detail`，插值 `{{name}}`。改文案时同步所有语言文件。
4. 不要把新的全局状态塞进已经过大的 `store.ts`。新增 slice / 模块文件，根 store 只组合。
5. 禁止 `any` 作为新代码的默认类型。Wails 返回值先收敛到 `types.ts` 或局部类型。
6. 样式：工作台走 `v2-theme-*.css` 与组件旁 CSS。不要把大块布局写进 `App.css` 或组件内超长 `style={{}}`。
7. 单测用 Vitest，文件名 `*.test.ts` / `*.test.tsx`，与实现同目录。按场景拆文件（`QueryEditor.external-sql-save.test.tsx` 这种已经过大，**新用例不要往里堆**）。

**【推荐】**

- 列表/表格虚拟化、编辑器、重面板保持现有拆分方向；新增 DataGrid 能力优先新文件而不是 `DataGrid.tsx`。
- 事件名、MIME、快捷键与现有 `gonavi:` / `utils/shortcuts` 对齐。
- 修改 UI 后跑相关 Vitest；能开应用时按真实用户路径点一遍。

```tsx
// ❌ BAD
export function QueryEditor() {
  // 上万行：执行、拖拽、分页、AI、快捷键全写在这
}

// ✅ GOOD
export function QueryEditor() {
  const execution = useQueryEditorExecution(props);
  return (
    <>
      <QueryEditorToolbar {...execution.toolbar} />
      <QueryEditorMonaco {...execution.editor} />
      <QueryEditorResultsPanel {...execution.results} />
    </>
  );
}
```

---

## 5. Java 规约（Alibaba 手册在本仓库的落地）

适用范围：`tools/jmx-helper/**`、`internal/jvm/testdata/**`。完整条款遵循[阿里巴巴 Java 开发手册](https://github.com/alibaba/p3c)。这里只写本仓库会踩的。

**【强制】**

1. 类名 UpperCamelCase，方法/变量 lowerCamelCase，常量 `UPPER_SNAKE`。禁止拼音缩写。
2. 工具类 `final` + 私有构造（见 `JmxHelperMain`）。
3. 不允许未捕获的含糊 `Exception` 后空 body。Helper 的 stdout JSON 协议可以捕获后写入 `ok/error`，但必须带异常类型。
4. 魔法值抽常量。比较用 `Objects.equals`；字符串用 `StandardCharsets.UTF_8`。
5. 单个 Java 文件 ≤ 400 行，方法 ≤ 80 行。JMX 协议处理放 `JmxRuntime`，不要把 `main` 写成上帝方法。
6. 禁止在 helper 里打密码、连接串到日志。stdout 仅用于约定 JSON。

---

## 6. 安全、兼容、提交

**【强制】**

1. 不提交密钥、`.env`、私钥、生产连接密码。配置里的密码字段按现有 `secretstore` / 脱敏逻辑处理。
2. SQL 审计、只读连接、生产库确认（`productionRiskConfirm`、`connectionReadOnly`）不得绕过。
3. 不随意改 Wails 方法签名和 `QueryResult` JSON 字段；前端、MCP、Web RPC 共用这些契约。
4. 提交信息遵循 `CONTRIBUTING.md`：`emoji type(scope): 中文描述`。未要求时不要 commit、不要 push。

**【推荐】** PR 保持单一主题；UI 变更附截图或录屏说明。
