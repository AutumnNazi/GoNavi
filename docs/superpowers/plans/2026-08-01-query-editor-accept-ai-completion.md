# 查询编辑器「接受 AI 补全」可配置快捷键 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增可配置快捷键 `acceptSqlAiCompletion`(默认 Right,可改为 Tab 等任意键),在查询编辑器 AI 幽灵补全可见时按下该键即接受补全;幽灵不可见/过期时不拦截按键。

**Architecture:** 快捷键注册进现有 `shortcuts.ts` 数据驱动清单(快捷键管理 UI 自动生效);QueryEditor 用 editor.onKeyDown 单机制处理接受,以 `acceptAiInlineGhost()` 返回 true 为前提才 preventDefault/stopPropagation,取代硬编码 `addCommand(RightArrow, contextKey)` 与 MonacoEditor fallback 补丁。

**Tech Stack:** TypeScript / React / Monaco Editor / Vitest

## Global Constraints

- 分支:`feat/query-editor-accept-ai-completion`(基座 dev `772d8391`,spec 已提交 `a457a5d2`)
- 前端测试命令:`cd frontend && npx vitest run <文件>`(测试在 `frontend/` 下运行)
- 提交信息:emoji 前缀 + 中文描述,结尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 不修改 `queryEditor/QueryEditorAiAssist.ts`(纯逻辑层)与 `triggerSqlAiCompletion`(Alt+\ 触发)行为
- i18n key 必须 6 个语言文件全加:`shared/i18n/{zh-CN,en-US,zh-TW,ja-JP,de-DE,ru-RU}.json`
- 新 action 元数据:`scope: 'queryEditor'`、`allowInEditable: true`、`allowWithoutModifier: true`、`disallowShift: true`、无 `requiredKey`;默认 `Right`(win/mac 相同)

---

### Task 1: 注册 acceptSqlAiCompletion 快捷键

**Files:**
- Modify: `frontend/src/utils/shortcuts.ts`(ShortcutAction 联合类型 ~L5-27、SHORTCUT_ACTION_ORDER ~L107、META_DEFINITIONS ~L152、DEFAULT_SHORTCUT_OPTIONS ~L280)
- Test: `frontend/src/utils/shortcuts.test.ts`(文件末尾追加 describe)

**Interfaces:**
- Produces: `ShortcutAction` 新增 `'acceptSqlAiCompletion'`;`DEFAULT_SHORTCUT_OPTIONS.acceptSqlAiCompletion = { mac: { combo: 'Right', enabled: true }, windows: { combo: 'Right', enabled: true } }`;`SHORTCUT_ACTION_META.acceptSqlAiCompletion` 含 scope/allowInEditable/allowWithoutModifier/disallowShift 元数据;i18n keys `app.shortcuts.action.acceptSqlAiCompletion.label|description`。

- [ ] **Step 1: 写失败测试**

在 `frontend/src/utils/shortcuts.test.ts` 末尾追加:

```ts
describe('acceptSqlAiCompletion', () => {
  it('默认绑定为 Right 且启用(win/mac 一致)', () => {
    expect(DEFAULT_SHORTCUT_OPTIONS.acceptSqlAiCompletion.mac).toEqual({ combo: 'Right', enabled: true });
    expect(DEFAULT_SHORTCUT_OPTIONS.acceptSqlAiCompletion.windows).toEqual({ combo: 'Right', enabled: true });
  });

  it('允许录制无修饰键的 Tab(裸键场景)', () => {
    expect(canRecordShortcutForAction('acceptSqlAiCompletion', 'Tab')).toBe(true);
  });

  it('拒绝 Shift+Tab(disallowShift)', () => {
    expect(canRecordShortcutForAction('acceptSqlAiCompletion', 'Shift+Tab')).toBe(false);
  });

  it('允许带修饰键组合(如 Ctrl+Right)', () => {
    expect(canRecordShortcutForAction('acceptSqlAiCompletion', 'Ctrl+Right')).toBe(true);
  });

  it('resolveShortcutBinding 对缺失配置回退默认 Right', () => {
    const binding = resolveShortcutBinding({}, 'acceptSqlAiCompletion', 'windows');
    expect(binding).toEqual({ combo: 'Right', enabled: true });
  });
});
```

同时把 `canRecordShortcutForAction`、`DEFAULT_SHORTCUT_OPTIONS`、`resolveShortcutBinding` 加入文件顶部已有的 import 列表(检查现有 import,缺则补)。

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npx vitest run src/utils/shortcuts.test.ts`
Expected: FAIL — `acceptSqlAiCompletion is undefined` / TS 类型错误。

- [ ] **Step 3: 实现注册**

`frontend/src/utils/shortcuts.ts` 三处修改:

1. `ShortcutAction` 联合类型,在 `'triggerSqlAiCompletion'` 后加 `| 'acceptSqlAiCompletion'`;
2. `SHORTCUT_ACTION_ORDER` 在 `'triggerSqlAiCompletion'` 后加 `'acceptSqlAiCompletion'`;
3. `SHORTCUT_ACTION_META_DEFINITIONS` 在 triggerSqlAiCompletion 条目后加:

```ts
  acceptSqlAiCompletion: {
    labelKey: 'app.shortcuts.action.acceptSqlAiCompletion.label',
    descriptionKey: 'app.shortcuts.action.acceptSqlAiCompletion.description',
    scope: 'queryEditor',
    allowInEditable: true,
    allowWithoutModifier: true,
    disallowShift: true,
  },
```

4. `DEFAULT_SHORTCUT_OPTIONS` 在 triggerSqlAiCompletion 条目后加:

```ts
  acceptSqlAiCompletion: {
    mac: { combo: 'Right', enabled: true },
    windows: { combo: 'Right', enabled: true },
  },
```

- [ ] **Step 4: 运行确认通过**

Run: `cd frontend && npx vitest run src/utils/shortcuts.test.ts`
Expected: PASS(新增 5 条 + 原有全过)。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/utils/shortcuts.ts frontend/src/utils/shortcuts.test.ts
git commit -m "✨ feat(shortcuts): 新增接受 SQL AI 自动补全快捷键(默认 Right)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: i18n 文案(6 语言)

**Files:**
- Modify: `shared/i18n/zh-CN.json`、`en-US.json`、`zh-TW.json`、`ja-JP.json`、`de-DE.json`、`ru-RU.json`(每文件在 `app.shortcuts.action.triggerSqlAiCompletion.*` 条目后插入)

**Interfaces:**
- Produces: 6 语言各 2 个 key:`app.shortcuts.action.acceptSqlAiCompletion.label` / `.description`。文案须与 Task 1 注册的 labelKey/descriptionKey 对应;`catalog.test.ts` 完整性测试校验 key 存在性。

- [ ] **Step 1: 写 6 语言条目**

在每个 JSON 的 triggerSqlAiCompletion 条目后插入(对照各文件已有翻译风格):

| 语言 | label | description |
|---|---|---|
| zh-CN | 接受 SQL AI 自动补全 | 当编辑器中显示 AI 灰色补全时,按下此键将补全内容写入编辑器 |
| en-US | Accept SQL AI Completion | When an AI inline completion is shown in the editor, press this key to insert it into the editor |
| zh-TW | 接受 SQL AI 自動補全 | 當編輯器中顯示 AI 灰色補全時,按下此鍵將補全內容寫入編輯器 |
| ja-JP | SQL AI 自動補完を受け入れる | エディターに AI インライン補完が表示されているとき、このキーを押すと補完内容がエディターに挿入されます |
| de-DE | SQL-AI-Vervollständigung übernehmen | Wenn eine KI-Inline-Vervollständigung im Editor angezeigt wird, drücken Sie diese Taste, um sie in den Editor einzufügen |
| ru-RU | Принять автодополнение SQL AI | Когда в редакторе отображается встроенное дополнение ИИ, нажмите эту клавишу, чтобы вставить его в редактор |

- [ ] **Step 2: 跑 i18n 完整性测试确认通过**

Run: `cd frontend && npx vitest run src/i18n/catalogIntegrity.test.ts src/i18n/catalog.test.ts`
Expected: PASS(6 语言 key 齐全;若 catalog.test.ts 有显式 key 清单则按报错补齐)。

- [ ] **Step 3: 提交**

```bash
git add shared/i18n/
git commit -m "🌐 i18n: 接受 SQL AI 自动补全快捷键文案(6 语言)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: QueryEditor 接入 onKeyDown 接受机制并移除硬编码

**Files:**
- Modify: `frontend/src/components/QueryEditor.tsx`
  - 绑定 useMemo:紧跟 `triggerSqlAiCompletionShortcutBinding`(~L1764)后
  - ref:紧跟 `triggerAiInlineCompletionRef`(~L1462)后新增 `acceptAiInlineCompletionRef`
  - 内部赋值:紧跟 `triggerAiInlineCompletionRef.current = ...`(~L4294)后
  - 清理:紧跟 dispose 处 `triggerAiInlineCompletionRef.current = null;`(~L4900)后
  - 删除 addCommand(RightArrow, ghostContext)(~L4298-4313 中 context 为 `QUERY_EDITOR_AI_INLINE_CONTEXT_KEY` 的那条,另一条 `inlineSuggestionVisible` 保留)
  - 新增 keydown effect:紧跟 `triggerSqlAiCompletionKeydownDisposableRef` effect(~L7906-7944)后
- Test: `frontend/src/components/QueryEditor.external-sql-save.test.tsx`(~L2031-2083 的既有接受断言改为 keydown 触发)

**Interfaces:**
- Consumes: `resolveShortcutBinding`、`isShortcutMatch`(已 import,确认)、`acceptAiInlineGhost()`(内部作用域函数,经 ref 暴露)
- Produces: `acceptSqlAiCompletionShortcutBinding: ShortcutPlatformBinding`;`acceptAiInlineCompletionRef: React.RefObject<(() => boolean) | null>`(返回 true 表示接受成功);keydown 监听在绑定启用时注册、接受成功才拦截事件。

- [ ] **Step 1: 先改既有测试为 keydown 触发(预期失败)**

在 `QueryEditor.external-sql-save.test.tsx` ~L2031-2083,把 `acceptInlineGhostCall` 机制替换为 keydown 触发:

```ts
      // 替换原来通过 addCommand mock 取回调的写法:
      // const acceptInlineGhostCall = editorState.editor.addCommand.mock.calls.find(...)
      const acceptRightArrowEvent = () => {
        const shortcutEvent = {
          type: 'keydown',
          key: 'ArrowRight',
          code: 'ArrowRight',
          keyCode: 39,
          which: 39,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          isComposing: false,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        };
        const monacoShortcutEvent = {
          browserEvent: shortcutEvent,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        };
        editorState.keyDownListeners.forEach((listener) => listener(monacoShortcutEvent));
        return { monacoShortcutEvent, shortcutEvent };
      };
```

把测试体内 `acceptInlineGhostCall?.[1]?.()` 两处调用替换为 `acceptRightArrowEvent()`,并新增断言:

```ts
      const { monacoShortcutEvent } = acceptRightArrowEvent();
      ...
      expect(monacoShortcutEvent.preventDefault).toHaveBeenCalled();
      expect(monacoShortcutEvent.stopPropagation).toHaveBeenCalled();
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npx vitest run src/components/QueryEditor.external-sql-save.test.tsx -t "accepts"`(或直接跑整个文件)
Expected: FAIL — keydown 无监听器,接受不发生,`executeEdits` 未被调用。

- [ ] **Step 3: 实现 keydown 接受机制**

QueryEditor.tsx:

1. 绑定 useMemo(紧跟 `triggerSqlAiCompletionShortcutBinding` 后):

```ts
  const acceptSqlAiCompletionShortcutBinding = useMemo(
      () => resolveShortcutBinding(shortcutOptions, 'acceptSqlAiCompletion', activeShortcutPlatform),
      [activeShortcutPlatform, shortcutOptions],
  );
```

2. ref(紧跟 `triggerAiInlineCompletionRef` 后):

```ts
  const acceptAiInlineCompletionRef = useRef<(() => boolean) | null>(null);
```

3. 内部赋值(紧跟 `triggerAiInlineCompletionRef.current = () => { requestAiInlineGhost(0, true, true); };` 后):

```ts
      acceptAiInlineCompletionRef.current = () => acceptAiInlineGhost();
```

4. dispose 清理(紧跟 `triggerAiInlineCompletionRef.current = null;` 后):

```ts
      acceptAiInlineCompletionRef.current = null;
```

5. 删除硬编码 addCommand:去掉 `editor.addCommand?.(monaco.KeyCode.RightArrow, () => { acceptAiInlineGhost(); }, QUERY_EDITOR_AI_INLINE_CONTEXT_KEY);` 整块(保留紧随其后的 `monaco.KeyCode.RightArrow` + `'inlineSuggestionVisible'` 那条)。

6. 新增 keydown effect(紧跟 `triggerSqlAiCompletionKeydownDisposableRef` effect 的 `}, [isActive, ...]);` 后):

```ts
  useEffect(() => {
      acceptSqlAiCompletionKeydownDisposableRef.current?.dispose?.();
      acceptSqlAiCompletionKeydownDisposableRef.current = null;

      const editor = editorRef.current;
      const binding = acceptSqlAiCompletionShortcutBinding;
      if (!editor?.onKeyDown || !binding?.enabled || !binding.combo) {
          return;
      }

      acceptSqlAiCompletionKeydownDisposableRef.current = editor.onKeyDown((event: any) => {
          if (!isActive) {
              return;
          }

          const browserEvent = event?.browserEvent || event?.event || event;
          if (!browserEvent) {
              return;
          }
          if (!isShortcutMatch(browserEvent, binding.combo)) {
              return;
          }
          // 接受成功才拦截按键;幽灵不存在或已过期时返回 false,键走默认行为。
          if (acceptAiInlineCompletionRef.current?.() === true) {
              event?.preventDefault?.();
              event?.stopPropagation?.();
              browserEvent.preventDefault?.();
              browserEvent.stopPropagation?.();
          }
      });

      return () => {
          acceptSqlAiCompletionKeydownDisposableRef.current?.dispose?.();
          acceptSqlAiCompletionKeydownDisposableRef.current = null;
      };
  }, [isActive, acceptSqlAiCompletionShortcutBinding]);
```

7. ref 声明:紧跟 `triggerSqlAiCompletionKeydownDisposableRef` 的 useRef 声明处加:

```ts
  const acceptSqlAiCompletionKeydownDisposableRef = useRef<any>(null);
```

(找到 `const triggerSqlAiCompletionKeydownDisposableRef = useRef<any>(null);` 所在行,在其后插入。若该 ref 是内联声明,保持同风格。)

- [ ] **Step 4: 运行确认通过**

Run: `cd frontend && npx vitest run src/components/QueryEditor.external-sql-save.test.tsx`
Expected: PASS(含 Step 1 更新的断言)。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/QueryEditor.tsx frontend/src/components/QueryEditor.external-sql-save.test.tsx
git commit -m "✨ feat(query-editor): AI 补全接受改为可配置快捷键(onKeyDown)

移除硬编码 addCommand(RightArrow, ghostContext),接受以
acceptAiInlineGhost() 成功为前提,幽灵过期时按键不拦截。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 删除 MonacoEditor fallback 补丁(死代码)

**Files:**
- Modify: `frontend/src/components/MonacoEditor.tsx`
  - 删除 `patchQueryEditorAiInlineRightArrowFallback` 函数定义(~L210 起到函数结束)
  - 删除 `handleMount` 中调用 `patchQueryEditorAiInlineRightArrowFallback(editor, monaco);`(~L903)

**Interfaces:**
- Consumes: 无(仅清理)
- Produces: 无。注意 `sameEditorPosition`(L55)被其他函数使用(L453/462/540/748),**必须保留**;`QUERY_EDITOR_AI_INLINE_CONTEXT_KEY` 在 QueryEditor 中仍用于 `createContextKey`(L3906)与 overlay 显示,保留。

- [ ] **Step 1: 先确认无其他引用**

Run: `cd frontend && grep -rn "patchQueryEditorAiInlineRightArrowFallback" src/`
Expected: 仅 MonacoEditor.tsx 两处(定义 + 调用);若测试文件有引用,一并删除对应测试。

- [ ] **Step 2: 删除函数与调用点**

删除 `patchQueryEditorAiInlineRightArrowFallback` 完整函数定义;`handleMount` 中删除该行调用。

- [ ] **Step 3: 跑相关测试确认不破坏**

Run: `cd frontend && npx vitest run src/components/MonacoEditor.test.tsx src/components/QueryEditor.external-sql-save.test.tsx`
(若 MonacoEditor.test.tsx 不存在,改为跑 `src/components/QueryEditor*.test.tsx` 全组)
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/MonacoEditor.tsx
git commit -m "♻️ refactor(monaco-editor): 删除 AI 补全 RightArrow fallback 死代码

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 新增接受行为测试(默认 Right / 可配置 Tab / 不拦截场景)

**Files:**
- Test: `frontend/src/components/QueryEditor.external-sql-save.test.tsx`(在既有 AI inline ghost describe 内追加 it)

**Interfaces:**
- Consumes: Task 3 的 keydown 机制(默认绑定 Right);store mock 的 `shortcutOptions`(手写部分对象,缺失 action 由 `resolveShortcutBinding` 回退默认)
- Produces: 4 条行为测试,固化验收标准。

- [ ] **Step 1: 写失败测试**

在文件中既有 AI inline ghost 测试组内追加以下 4 条 `it`。mount/幽灵渲染流程参照既有测试模板(如 L1700-1807 的 "uses grounded AI inline ghost…",含 `vi.stubGlobal('window', { go: { aiservice: { Service: inlineAiService } }, … })`、`create(<QueryEditor tab={createTab({ query: 'SELECT * FROM ', dbName: 'main' })} />)`、`editorState.value`/`editorState.position` 赋值)。幽灵渲染等待:输入后 `vi.advanceTimersByTime(220)` + 循环 `await Promise.resolve()`。

Right 键事件构造(4 条测试共用):

```ts
    const dispatchAcceptKey = async (key: string, code: string, keyCode: number) => {
      const shortcutEvent = {
        type: 'keydown',
        key,
        code,
        keyCode,
        which: keyCode,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      const monacoShortcutEvent = {
        browserEvent: shortcutEvent,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      await act(async () => {
        editorState.keyDownListeners.forEach((listener) => listener(monacoShortcutEvent));
        for (let i = 0; i < 8; i += 1) {
          await Promise.resolve();
        }
      });
      return { shortcutEvent, monacoShortcutEvent };
    };
```

4 条测试:

```ts
  it('幽灵可见时按默认键 Right 接受补全并拦截按键', async () => {
    // mount + 渲染幽灵:参照 "uses grounded AI inline ghost…" 模板,
    // 输入 'SELECT * FROM ' 后 advanceTimersByTime(220) + Promise 循环,
    // 断言 ghostOverlay?.textContent 存在(幽灵已渲染)
    const { shortcutEvent, monacoShortcutEvent } = await dispatchAcceptKey('ArrowRight', 'ArrowRight', 39);

    expect(editorState.editor.executeEdits).toHaveBeenCalledWith(
      'gonavi-ai-inline-sql-completion',
      [expect.objectContaining({ text: expect.any(String) })],
    );
    expect(monacoShortcutEvent.preventDefault).toHaveBeenCalled();
    expect(monacoShortcutEvent.stopPropagation).toHaveBeenCalled();
    expect(shortcutEvent.preventDefault).toHaveBeenCalled();
    expect(shortcutEvent.stopPropagation).toHaveBeenCalled();
  });

  it('幽灵不可见时按下 Right 不拦截', async () => {
    // mount 后不触发任何幽灵渲染
    const { shortcutEvent, monacoShortcutEvent } = await dispatchAcceptKey('ArrowRight', 'ArrowRight', 39);

    expect(monacoShortcutEvent.preventDefault).not.toHaveBeenCalled();
    expect(monacoShortcutEvent.stopPropagation).not.toHaveBeenCalled();
    expect(shortcutEvent.preventDefault).not.toHaveBeenCalled();
    expect(shortcutEvent.stopPropagation).not.toHaveBeenCalled();
    expect(editorState.editor.executeEdits).not.toHaveBeenCalled();
  });

  it('幽灵已过期(光标移动)时按下 Right 不拦截', async () => {
    // 渲染幽灵后,把 editorState.position 改为 { lineNumber: 1, column: 1 }(离开幽灵位置)
    editorState.position = { lineNumber: 1, column: 1 };
    const { shortcutEvent, monacoShortcutEvent } = await dispatchAcceptKey('ArrowRight', 'ArrowRight', 39);

    expect(monacoShortcutEvent.preventDefault).not.toHaveBeenCalled();
    expect(shortcutEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('绑定改为 Tab 后按 Tab 接受补全', async () => {
    // mount 前设置 storeState.shortcutOptions.acceptSqlAiCompletion:
    // { mac: { enabled: true, combo: 'Tab' }, windows: { enabled: true, combo: 'Tab' } }
    // (直接赋值即可;resolveShortcutBinding 读取该对象)
    // 渲染幽灵后:
    await dispatchAcceptKey('Tab', 'Tab', 9);

    expect(editorState.editor.executeEdits).toHaveBeenCalledWith(
      'gonavi-ai-inline-sql-completion',
      [expect.objectContaining({ text: expect.any(String) })],
    );
  });
```

- [ ] **Step 2: 运行确认通过**

Run: `cd frontend && npx vitest run src/components/QueryEditor.external-sql-save.test.tsx`
Expected: 新增 4 条 PASS,既有全过。

- [ ] **Step 3: 跑整个前端测试套件确认无回归**

Run: `cd frontend && npx vitest run`
Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/QueryEditor.external-sql-save.test.tsx
git commit -m "✅ test(query-editor): AI 补全接受快捷键行为测试(默认 Right/可配置 Tab/不拦截场景)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 完成检查

- [ ] 快捷键管理 UI 中「接受 SQL AI 自动补全」出现,默认显示 →
- [ ] 改绑 Tab 后:幽灵可见时 Tab 接受;无幽灵时 Tab 缩进/接受原生 suggest 不受影响
- [ ] 幽灵过期时按绑定键不吞键
- [ ] 全量前端测试通过
- [ ] `git log` 包含 5 个任务提交(1 docs spec + 4 功能提交)
- [ ] push 分支到 origin,`gh pr create` 向 Syngnat/GoNavi base dev(PR 描述按仓库风格,结尾附 Claude Code 生成说明)
