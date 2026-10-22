# 插件导出：查询结果物化快照与流式分块

插件导出把**已经物化的查询结果快照**交给受信任的原生插件，让插件生成一个文档。v1 一次渲染整个快照；声明 `streaming` 的 v2 导出器按 512 行分块渲染，从而不受 4,096 行总上限限制。它仍不是新的数据库操作，也不是“导出整张表”的快捷方式。

当前示例是 [Typed NDJSON exporter](<../../examples/plugins/ndjson-exporter/gonavi.plugin.json>)。它只读取宿主传入的快照，在 stdout 的插件协议上返回文档文本；它不连接数据库、不访问网络、不接收目标路径，也不创建目标文件。

## 范围和边界

插件分支只接受用户明确选择的查询结果 selected/page 快照：

- 宿主先取得已经物化的行和列，再按用户的列顺序构造快照。
- 插件只看到快照中的列和值，不会重新查询数据库，不会执行 SQL，也不会把页面预览扩展成全量结果。
- 快照可以有零行；列必须存在，选列必须是源列的唯一子集。选列顺序就是插件收到的顺序。
- 当前不提供 query-all、table/database/headless 导出、流式数据库游标、CLI/Web 插件执行，也不改变既有 CSV/XLSX 等内置格式流程。
- 插件不接收文件名、目录、URL 或 save-dialog 结果，也不能要求宿主打开文件。原生插件是受信任代码，不是 OS 沙箱。

导出会把所选数据发送给第三方代码。启用插件前应审核包、权限、版本和来源，并确认所选结果可以交给该插件处理。

## 声明导出器

声明需要 `data.export` 权限、原生 backend 和 exporter 命令。`contributes.exporters` 最多八项；每项必须声明 `id`、`name`、`command`、`extension`、`contentType`：

```json
{
  "permissions": ["data.export"],
  "backend": {
    "default": {"executable": "bin/plugin", "runtime": "native"}
  },
  "contributes": {
    "commands": [{
      "id": "render",
      "title": "Render typed NDJSON snapshot",
      "effect": "read"
    }],
    "exporters": [{
      "id": "ndjson",
      "name": "Typed NDJSON (lossless cell tags)",
      "command": "render",
      "extension": "ndjson",
      "contentType": "application/x-ndjson",
      "streaming": true
    }]
  }
}
```

`streaming` 可选，缺省为 `false`；设为 `true` 即声明支持 v2 分块协议。示例 NDJSON 导出器已声明流式。

Exporter ID 使用 `^[a-z][a-z0-9_.-]{0,63}$`；extension 是 1–16 位小写 ASCII 字母或数字，不能含点或路径；content type 必须是无参数的 `text/...` 或 `application/...`。完整字段、重复键、别名、大小写和权限规则以 [exporter contract](<exporter-contract.md>) 为准。

导出器的稳定格式身份是 `plugin:<pluginID>:<exporterID>`。宿主按精确的 plugin ID、exporter ID、版本、digest、generation 和权限绑定它；格式字符串不能通过 trim、大小写转换或改写变成内置格式。声明导出器的命令属于保留命令，不能通过普通插件调用、MCP/Agent 工具或窗口命令菜单绕过私有准入。

## 在界面里使用

只有查询结果的导出对话框会列出已启用插件的格式。表格工具栏、全部结果和需要重新查询的范围不会提供这些格式，也不能沿用上一次选中的插件格式。

选择格式时，宿主固定当时的包摘要和 generation。插件被禁用、移除或数据根目录变化后，必须重新选择同一格式；界面不会自动换成另一个插件或内置格式。只提交格式、选中列、固定 pin 和进度所需字段，不附带 CSV、XLSX 或 SQL 选项。

导出器格式列表会标记“流式”。界面上的数字若已经超出 JavaScript 安全整数，导出会直接拒绝，而不是把已经丢失的精度交给插件。字符串保持原样，不会根据内容猜测日期或二进制。

## 快照和 Typed NDJSON

宿主把每个单元格标成 `missing`、`null`、`string`、`number`、`boolean`、`json` 或 `binary`。数字以原始 JSON 数值文本传递，不先转成浮点。示例把每一行写成一个对象，列顺序与所选列一致，每列的值仍是 `{kind,value?}`：

- `number` 嵌入原始数值文本，`boolean` 使用 JSON 布尔值，`json` 嵌入严格 JSON。
- `string` 和 `binary` 使用 JSON 字符串；二进制是标准 Base64。
- `missing` 和 `null` 只保留 kind，二者不相等。

这不是去掉类型标签的普通 NDJSON。非流式导出的完整请求和响应各自不超过 512 KiB；超限时整次失败，不截断，也不重新查询。

声明 `"streaming": true` 后，宿主按所选顺序冻结全部行，再以每块最多 512 行发送 v2 请求；即使选中 0 行，也会发送一个空块（`rows:[]`、`chunkIndex:0`、`chunkCount:1`），让插件决定是否写表头或空文档：`{protocolVersion:2,exporterId,columns,chunkIndex,chunkCount,rows}`。插件返回 `{protocolVersion:2,exporterId,chunkIndex,rowCount,text}`，必须回显相同的导出器 ID 和块序号。插件通过 `chunkIndex`/`chunkCount` 自行决定表头、分隔符和表尾；宿主只按顺序追加文本。每块请求和响应仍需各自不超过 512 KiB，单个分块最多 512 行（允许 0 行）；整份文档不再有总行数或单元格上限。超限、块序号不符或任何一块失败都会让整次导出失败，不会截断，也不会退回快照模式。

流式块是无状态、可独立重试的；重试某一块不会重放之前的块。进度只在一整块写完后推进。

## 文件提交

宿主弹出保存对话框，按声明的扩展名补后缀，并拒绝把文件写进应用配置目录。自动补后缀后若目标已存在，需要用户重新确认该实际路径。插件渲染成功后，宿主先写入同目录临时文件，同步并关闭，再检查数据根目录、执行所有者和 pin，最后原子替换。

替换开始前失败会留下原来的目标文件。替换一旦开始，随后的错误只表示结果未知：界面提示检查目标文件，不自动重试，也不声称已经回滚。成功提交后，迟到的取消或禁用不会把这次结果改成失败。

Web 插件管理仍然拒绝执行。当前没有 CLI 导出模式。
