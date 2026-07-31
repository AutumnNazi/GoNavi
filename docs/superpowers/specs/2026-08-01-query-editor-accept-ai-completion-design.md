# 查询编辑器「接受 AI 补全」可配置快捷键

日期:2026-08-01
分支:`feat/query-editor-accept-ai-completion`(基于上游 dev `772d8391`)
目标 PR:向 `Syngnat/GoNavi` 的 `dev` 提 PR

## 背景

GoNavi 查询编辑器在输入 SQL 时,若已配置 AI 主力 provider,会自动请求 AI 灰色幽灵补全(ghost text),以 overlay 形式显示在光标处。当前「接受」逻辑是**硬编码 RightArrow**(`editor.addCommand(KeyCode.RightArrow, acceptAiInlineGhost, ghostContextKey)`),用户无法修改,且存在一个已知边界:幽灵过期时需 MonacoEditor.tsx 的 fallback 补丁模拟 `cursorRight` 兜底。

需求:在快捷键管理中新增「接受 AI 自动补全」项,默认 RightArrow(保持现有行为),允许用户改为 Tab 或任意键;当幽灵补全可见时按下该键,将 AI 提示内容写入编辑器。

## 目标

1. 新增可配置快捷键 `acceptSqlAiCompletion`,默认 `Right`(win/mac),在快捷键管理 UI 中可见、可录制、有冲突检测。
2. 查询编辑器中该键按下且幽灵可见时接受补全;幽灵不可见或已过期时不拦截按键(走默认行为)。
3. 删除旧机制与死代码:硬编码 RightArrow addCommand + MonacoEditor fallback 补丁。
4. 测试覆盖新机制与默认值。

## 非目标

- 不改动 `triggerSqlAiCompletion`(Alt+\\ 触发幽灵)及其行为。
- 不改动 AI 补全的生成链路(QueryEditorAiAssist 纯逻辑层)。
- 不推 fork 远程 dev;仅本地 dev 同步 + 功能分支 push。

## 设计

### A. 快捷键注册(frontend/src/utils/shortcuts.ts)

- `ShortcutAction` 新增 `'acceptSqlAiCompletion'`,插入 `SHORTCUT_ACTION_ORDER`(位于 `triggerSqlAiCompletion` 之后)。
- `SHORTCUT_ACTION_META_DEFINITIONS` 新增:
  - `labelKey: 'app.shortcuts.action.acceptSqlAiCompletion.label'`
  - `descriptionKey: 'app.shortcuts.action.acceptSqlAiCompletion.description'`
  - `scope: 'queryEditor'`(不进 App.tsx 全局调度器)
  - `allowInEditable: true`
  - `allowWithoutModifier: true`(允许裸键 Tab/→)
  - `disallowShift: true`(避免 Shift+Tab / Shift+→ 与选择、反缩进冲突)
  - 不设 `requiredKey`(任意键可绑)
- `DEFAULT_SHORTCUT_OPTIONS` 新增:`mac: { combo: 'Right', enabled: true }`、`windows: { combo: 'Right', enabled: true }`。

### B. i18n(shared/i18n/{zh-CN,en-US,zh-TW,ja-JP,de-DE,ru-RU}.json)

- label:「接受 SQL AI 自动补全」/ "Accept SQL AI Completion"(按各语言现有风格翻译)
- description:当编辑器中显示 AI 灰色补全时,按下此键将补全内容写入编辑器 / "When an AI inline completion is shown in the editor, press this key to insert it"

### C. QueryEditor.tsx 接入(onKeyDown 单机制)

1. 新增绑定解析(与 `triggerSqlAiCompletionShortcutBinding` 并列):
   `acceptSqlAiCompletionShortcutBinding = useMemo(() => resolveShortcutBinding(shortcutOptions, 'acceptSqlAiCompletion', activeShortcutPlatform), [activeShortcutPlatform, shortcutOptions])`
2. 新增 effect(与 `triggerSqlAiCompletionKeydownDisposableRef` 同模式):

   ```
   editor.onKeyDown((event) => {
     if (!isActive) return;
     const browserEvent = event?.browserEvent || event?.event || event;
     if (!browserEvent) return;
     if (!isShortcutMatch(browserEvent, binding.combo)) return;   // IME 已自动过滤
     if (acceptAiInlineGhost()) {                                 // 接受成功才拦截
       event?.preventDefault?.(); event?.stopPropagation?.();
       browserEvent.preventDefault?.(); browserEvent.stopPropagation?.();
     }
     // 失败(幽灵过期/不存在)→ 不拦截,键走默认行为
   });
   ```

   依赖 `[isActive, binding]`,绑定变化自动重新注册。
3. 移除硬编码 `editor.addCommand(KeyCode.RightArrow, acceptAiInlineGhost, QUERY_EDITOR_AI_INLINE_CONTEXT_KEY)`(QueryEditor.tsx 中 RightArrow 两条命令中 context 为 `gonaviAiInlineSuggestionVisible` 的那条;`inlineSuggestionVisible` 那条是 Monaco 原生 inlineSuggest 的,保留)。
4. 删除 MonacoEditor.tsx 的 `patchQueryEditorAiInlineRightArrowFallback` 及其调用点(死代码)。

### D. 测试

1. **QueryEditor.external-sql-save.test.tsx**(约 2031-2083 行):改用模拟 keydown 走 onKeyDown 路径,断言 `executeEdits('gonavi-ai-inline-sql-completion')` 与事件被消费。
2. 新增测试:
   - 幽灵可见 + 按下配置键(Right)→ 接受且事件被 preventDefault/stopPropagation
   - 幽灵不可见 → 不拦截
   - 幽灵过期(位置变化)→ 接受失败 → 不拦截
   - 绑定改为 `Tab` → 按 Tab 接受幽灵(可配置性)
3. **shortcuts.test.ts**(或现有相关测试):默认值断言(win/mac = `Right`)、`canRecordShortcutForAction('acceptSqlAiCompletion', 'Tab') === true`、`Shift+Tab` 被拒。
4. i18n 完整性测试(`catalog.test.ts`)自动校验 6 语言 key。

## 风险与注意事项

- `isShortcutMatch` 已处理 IME 组合输入,Tab 在中文输入法组合期间不会被误触发。
- 拦截以 `acceptAiInlineGhost()` 返回 true 为前提,「过期幽灵」场景由默认行为自然兜底,无需 fallback 补丁。
- 快捷键管理 UI 纯数据驱动,注册后自动出现,无需改 App.tsx。
- 绑定字母键时,幽灵可见期间该字母将被吞掉(接受补全)— 属用户自选,默认 Right/Tab 均为非输入键。

## 验收标准

- 查询编辑器出现 AI 幽灵补全 → 按 → 接受(与现行为一致)
- 快捷键管理中该项默认显示 →;改为 Tab 后,幽灵可见时按 Tab 接受,无幽灵时 Tab 照常缩进/接受原生 suggest
- 幽灵过期时按键不被吞
- 全部相关测试通过(vitest)
