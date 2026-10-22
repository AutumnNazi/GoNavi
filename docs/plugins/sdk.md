# Plugin SDKs

GoNavi plugins run outside the main application process. The Go SDK and TypeScript helper implement protocol v1 without importing the host's internal packages. They provide transport and cancellation, not an operating-system sandbox or unrestricted host API.

See the [wire protocol](<protocol.md>) and [build, package and check workflow](<development.md>). The exact shared schema is in the [implementation contract](<implementation-contract.md>). Go callers use `ValidatePermissionNotes`, and TypeScript callers use `validatePermissionNotes`, before packaging. A note must name a declared permission and is plain text of at most 160 bytes.

## Go

The [Go module](<../../sdk/go/go.mod>) is named `github.com/Syngnat/GoNavi/sdk/go` and requires Go 1.22 or later. Its package name is `plugin`. It uses only the standard library. The host has a separate Go toolchain requirement.

No public module version is assumed here. During development, consume a local checkout from a separate module:

```sh
go mod init example.org/my-plugin
go mod edit -require=github.com/Syngnat/GoNavi/sdk/go@v0.0.0
go mod edit -replace=github.com/Syngnat/GoNavi/sdk/go=/absolute/path/to/GoNavi/sdk/go
```

The [hello plugin](<../../examples/plugins/hello/main.go>) is a complete executable, not host-internal sample code. Its independent [example module](<../../examples/plugins/go.mod>) already contains the local replacement.

A handler receives the invocation context and raw JSON arguments:

```go
server := plugin.NewServer(plugin.Options{
    Handlers: map[string]plugin.Handler{
        "hello": func(ctx context.Context, args json.RawMessage) (any, error) {
            if err := ctx.Err(); err != nil {
                return nil, err
            }
            return map[string]string{"message": "Hello!"}, nil
        },
    },
})
err := server.ServeStdio(ctx)
```

Pass a process-lifetime context to `ServeStdio` and exit main when it returns. Report failures on stderr, never stdout. Use `signal.NotifyContext` for application shutdown; the hello example shows this wiring.

### Concurrency and cleanup

- The protocol reader handles ping and cancellation while initialization and command handlers run in separate goroutines.
- Handlers may run concurrently. Protect shared state and pass their contexts to HTTP, database, subprocess and timer operations.
- `$/cancelRequest` cancels the matching handler context. Disconnect, lifecycle cancellation and shutdown cancel all handlers. A context-aware handler returns promptly; the SDK reports cancellation as `-32800`.
- Defaults are 32 active handlers, one MiB per protocol frame, 64 queued output frames and a two-second handler cleanup wait. Full output queues fail the connection instead of blocking the control reader.
- `Serve` owns both streams. Their `Close` methods must unblock pending reads and writes. It closes the streams on cancellation and return.
- A Go goroutine that ignores cancellation cannot be forcibly stopped inside the SDK. After the cleanup limit, `Serve` returns an error; the executable must exit. The host independently terminates an uncooperative process tree.
- Initialization callbacks are asynchronous and cancellable. Only a successful, uncancelled initialization permits invocations.

Return `*plugin.Error` only for messages safe to expose to the host. Ordinary errors and recovered handler panics become a generic internal error; their private details are not copied onto the wire. Do not put secrets in public error data or stderr.

The [manifest and UI types](<../../sdk/go/types.go>) match the v1 JSON names. `ParseManifest` rejects a manifest over 1 MiB, trailing JSON, and unknown fields, including fields inside a panel body or AI model. It names the offending field when that name is at most 64 bytes of printable ASCII, and omits any longer or non-ASCII name so a hostile manifest cannot echo payload text through a diagnostic. Types and `ParseManifest` do not replace host validation. Call `ValidateCommand` for every contributed command before packaging: the local ID matches the host pattern, the title is nonempty and at most 256 bytes, the description is at most 4096 bytes, and the effect is empty, `read`, `write`, or `unknown`. `WRITE`, `sideeffect`, and `Read` are rejected. This check does not let a data source use a write command. Call `ValidateSkillDocument` on each skill entry and companion before packaging. The file must be nonempty UTF-8 of at most 64 KiB and must not contain NUL. The check does not execute the document or grant tools. The same checks exist for every contribution: `ValidateDataSource`, `ValidateDataSourceCommand`, `ValidateAIProvider`, `ValidateExporter`, `ValidateSkillResources`, `ValidateSkillMetadata` and `ValidatePermissionNotes`. Run `plugin check` on the built package before distributing it.

### Extension entry points

Each contribution type has one SDK entry point. Use it instead of writing the JSON-RPC loop yourself; reserved commands are rejected when a generic UI, window or tool tries to call them.

| Contribution | Entry point | Notes |
|---|---|---|
| Data source | `NewDataSourceDispatcher(operations DataSourceOperations) *DataSourceDispatcher` | The host owns sessions and sends queries; the plugin answers queries, metadata, writes and transactions. `Exec`/`Begin`/`Commit`/`Rollback` are optional v2 callbacks. |
| AI provider | `NewAIProviderDispatcher(root context.Context, options AIProviderOptions) (*AIProviderDispatcher, error)` | One root context bounds the whole provider session; the host projects only the selected credential. |
| Exporter | `NewExporterDispatcher(handlers map[string]ExporterRender) (*ExporterDispatcher, error)` | One bounded render per request against already-materialized rows; the host owns the destination file. |
| Exporter payload | `NewExporterCell(kind ExporterCellKind, value string) (ExporterCell, error)` | Tagged cell builder for `ExporterSnapshot` values. |
| Exporter wire check | `EncodeExporterRequest(ctx, exporterID string, snapshot ExporterSnapshot) (json.RawMessage, error)`, `ValidateExporterSnapshot(ctx, snapshot ExporterSnapshot) error` | Encode or pre-validate without sending; useful in your own tests. |
| Host callbacks | `HostFromContext(ctx context.Context) (*Host, bool)` | Caller-bound handle for exactly `host.log` and `host.describe`. There is no general host API. |

### Public types

| Group | File | Types |
|---|---|---|
| Manifest, UI and wire | [types.go](<../../sdk/go/types.go>) | `Manifest`, `Contributions`, `UINode`, `InitializeParams`, `InvokeParams`, `SkillContent` |
| Data sources | [datasource_types.go](<../../sdk/go/datasource_types.go>) | `DataSourceConfig`, `DataSourceRequest`, `DataSourceQueryResult`, `DataSourceColumnDefinition`, `DataSourceColumnDefinitionWithTable`, `DataSourceIndexDefinition`, `DataSourceForeignKeyDefinition`, `DataSourceTriggerDefinition` |
| AI provider declarations | [ai_provider_manifest.go](<../../sdk/go/ai_provider_manifest.go>) | `AIProvider`, `AIModel` |
| AI provider streaming | [aiprovider_types.go](<../../sdk/go/aiprovider_types.go>) | `AIProviderConfig`, `AIProviderRegistration`, `AIProviderRequest`, `AIProviderMessage`, `AIProviderTool`, `AIProviderToolFunction`, `AIProviderToolCall`, `AIProviderToolCallFunction`, `AIProviderLimits`, `AIProviderStart`, `AIProviderDelta`, `AIProviderEvent`, `AIProviderEmit`, `AIProviderGenerate`, `AIProviderCompletion`, `AIProviderBatch`, `AIProviderUsage` |
| AI provider failures | [aiprovider_limits.go](<../../sdk/go/aiprovider_limits.go>) | `AIProviderFailure` |
| Exporter results | [export_types.go](<../../sdk/go/export_types.go>) | `ExporterResult`, `ExporterCell` |
| Host identity | [host_describe.go](<../../sdk/go/host_describe.go>) | `Host`, `HostIdentity` |

### Constants, errors and cell kinds

| Group | Identifiers |
|---|---|
| Protocol | `APIVersion`, `DefaultMaxFrameBytes`, `AIProviderImageFrameBytes`, `DataSourceProtocolVersion`, `DataSourceWriteProtocolVersion` |
| Data source errors | `ErrDataSourceRequest`, `ErrDataSourceLimit`, `ErrDataSourceResult`, `ErrDataSourceSession`, `ErrDataSourceUnsupported` |
| Manifest shapes | `Backend`, `Requirement`, `Panel` |
| Exporter payload | `ExporterChunkRows`, `EncodeExporterChunkRequest`, `ExporterChunkResult`, `ExporterMaxEnvelopeBytes` and the cell kinds `ExporterBoolean`, `ExporterNumber`, `ExporterString`, `ExporterJSON`, `ExporterNull`, `ExporterMissing`, `ExporterBinary` |

### AI provider images

Declare `supportsImages` in both `contributes.aiProviders` and the runtime registration. Images then arrive only on user messages (`AIProviderMessage.Images` in Go, `images` in TypeScript) as bounded base64 data URLs. The host forwards `image/png`, `image/jpeg`, `image/webp` and `image/gif` only; it never fetches a remote URL and never accepts images on system, assistant or tool messages. Limits are four images per message, 4 MiB decoded per image, 24 MiB encoded per request and a 32 MiB request frame. A plugin that declares the capability must raise its own frame budget to `AIProviderImageFrameBytes` (Go `Options.MaxFrameBytes`) or `AI_PROVIDER_IMAGE_MAX_REQUEST_BYTES` (TypeScript `FrameReader`); the defaults remain one MiB for text-only plugins.

## TypeScript

The [TypeScript package](<../../sdk/typescript/package.json>) is private, dependency-free source, not a published npm package. Copy or reference its [entry point](<../../sdk/typescript/src/index.ts>) through your own compiler or bundler. No npm installation or publication is required. Compile the source to JavaScript before using a Node script entry; the host does not run TypeScript directly.

Exports include manifest, declarative UI, status and JSON-RPC types, and the separate-window `PluginWindowBridge` type.

Runtime helpers:

- transport: `FrameReader`, `DEFAULT_MAX_FRAME_BYTES`, `Protocol`, `ProtocolError`
- data sources: `DataSourceDispatcher`, `DATA_SOURCE_PROTOCOL_VERSION`, `DATA_SOURCE_WRITE_PROTOCOL_VERSION`, `DataSourceExecResult`, `DataSourceTransactionID`
- declaration checks: `validateCommand`, `validatePermissionNotes`, `validateSkillMetadata`, `validateSkillResources`, `validateSkillDocument`, `validateDataSource`, `validateDataSourceCommand`, `validateAIProvider`, `validateExporter`
- manifest parsing: `parseManifest`

`validateCommand`, `validateSkillDocument`, and `parseManifest` match the Go rules above. [test/exports.test.ts](<../../sdk/typescript/test/exports.test.ts>) keeps every documented name exported and mentioned here, so renaming one is a deliberate breaking change.

```ts
import { FrameReader, Protocol } from './compiled-sdk/index.js';

const protocol = new Protocol({
  handlers: {
    hello: async (args, signal) => {
      signal.throwIfAborted();
      return { message: 'Hello!', arguments: args };
    },
  },
  send: (frame) => new Promise<void>((resolve, reject) => {
    process.stdout.write(frame, (error) => error ? reject(error) : resolve());
  }),
  onClose: () => {
    process.stdin.destroy();
    process.stdout.end();
  },
  onFatal: () => { process.exitCode = 1; },
});
const reader = new FrameReader((frame) => protocol.accept(frame));
process.stdin.on('data', (chunk: Uint8Array) => {
  try { reader.push(chunk); }
  catch { protocol.close(); process.exitCode = 1; }
});
process.stdin.on('end', () => {
  try { reader.end(); }
  catch { process.exitCode = 1; }
  protocol.close();
});
process.stdin.on('error', () => { protocol.close(); process.exitCode = 1; });
process.stdout.on('error', () => { protocol.close(); process.exitCode = 1; });
process.on('SIGTERM', () => protocol.close());
```

The snippet is a Node transport adapter; use your application's Node types when compiling it. The SDK itself has no Node-specific imports. Keep transport writes ordered, release pending I/O on close and give application cleanup a bounded deadline. The host remains the final process-tree cleanup authority.

`Protocol.accept` does not await handlers. Async handlers must yield and propagate `AbortSignal` to their I/O. An infinite loop or CPU-heavy synchronous function still blocks JavaScript's event loop: promises do not provide CPU isolation. Put CPU work in a Node worker or separate process, with a cancellation/termination path. Do not load plugin JavaScript in GoNavi's main renderer.

The helper uses the same default frame, active-handler and output-queue limits as the Go SDK. `FrameReader` bounds incomplete UTF-8 frames and rejects malformed UTF-8 or an unfinished frame at EOF. `close` aborts active handlers; `flush` waits only for already queued transport writes.

## UI choices

### Embedded panel

Declare `contributes.panels` as data. Supported node types are `text`, `alert`, `column`, `row`, `button` and `table`. Buttons refer to declared commands. Strings render as text, not HTML. The host rejects unsupported or oversized trees; there is no eval, inline expression language, arbitrary CSS or third-party React component injection.

A panel may instead declare `html: {source}` and exactly one body. This requires the `ui.html-panel` permission and at most 256 KiB of UTF-8 without NUL. The main window shows it in an iframe with `sandbox="allow-scripts"` and an opaque origin; the source never enters the host DOM. Its CSP sets every channel to `none` except inline styles/scripts and `data:` images/fonts/media, so page fetch/XHR/WebSocket, external subresources, forms, nested frames, objects and base-URL changes are blocked. Inline scripts can render interactive UI but receive no host bridge, cookies, storage, credentials or `window.gonaviPlugin`; use the backend command path for data. The iframe also denies sensitive browser permissions. This is an origin and resource-loading boundary, not an OS or network-stack sandbox: treat the plugin package as trusted code. Custom HTML and the separate custom window remain separate features.

### Separate custom window

A packaged HTML entry can request a dedicated Wails child process through `window.entry`. The child receives `window.gonaviPlugin`; the main application does not. The [bridge type](<../../sdk/typescript/src/window.ts>) exposes only:

```ts
const identity = await window.gonaviPlugin.ready;
const controller = new AbortController();
const result = await window.gonaviPlugin.invoke(
  'hello', { name: identity.pluginId }, { signal: controller.signal },
);
await window.gonaviPlugin.close();
```

Declare the injected property in your own window type using `PluginWindowBridge`. The bridge is installed before entry scripts; `ready` provides metadata and is not an invocation prerequisite. Plugin identity and generation are fixed by the parent, not caller arguments. Disable/re-enable invalidates the old window; outstanding calls are cancelled and stale responses discarded. Never retry a write merely because its response was lost.

Use packaged relative assets. Remote scripts, network access, frames and workers are unavailable in the plugin WebView; external work belongs in the backend. Current bridge limits are eight pending calls, one MiB per JSON request/response and a 30-second call deadline. UI assets are limited to eight MiB per file and HTML to two MiB. The child has its own heartbeat; a hung window is terminated, not automatically restarted. Native window launch and rendering require desktop-platform testing beyond SDK transport tests.

## Supported scope

The SDKs support initialization, ping, invocation, cancellation, shutdown and declarative manifest types. They do not advertise database drivers, query interception, arbitrary host reflection, host credentials or a plugin-to-host RPC catalog. Undeclared capabilities require a future negotiated contract. Permissions describe user-approved intent; they do not stop a trusted native executable from making direct OS calls.
