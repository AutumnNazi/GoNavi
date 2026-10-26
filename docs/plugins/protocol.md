# Plugin protocol v1

The [implementation contract](<implementation-contract.md>) fixes wire names and ownership. This guide explains the shipped SDK behavior; it does not extend that contract.

## Transport

A backend communicates over stdin/stdout using UTF-8 JSON-RPC 2.0, one JSON object per newline. Stdout contains protocol frames only. Write bounded, non-sensitive diagnostics to stderr. Do not use Content-Length headers, batches or a shell transport.

The host sends monotonically increasing positive numeric request IDs per process. SDKs also accept string IDs and preserve their type in responses. Notifications have no ID and receive no reply. The supported cancellation notification is `$/cancelRequest`. Invocation notifications do not execute commands.

One MiB is the default maximum request/response frame. A malformed or oversized stream may fault the plugin. Successful responses have `result`, including `null` when appropriate; errors have `error` instead. Never send both.

## Methods

| Method | Direction | Purpose |
|---|---|---|
| `plugin.initialize` | host → plugin | Handshake carrying API version, plugin identity, granted permissions and configuration |
| `plugin.ping` | host → plugin | Liveness check during startup and steady state |
| `plugin.invoke` | host → plugin | Run one declared command; cancellable and time-bounded |
| `$/cancelRequest` | host → plugin | Notification that cancels the in-flight call with the given ID |
| `plugin.shutdown` | host → plugin | Cooperative stop; the host still terminates an uncooperative process tree |
| `plugin.lifecycle` | host → plugin | One-way `running` notification after initialization; see [lifecycle](<lifecycle.md>) |
| `host.describe` | plugin → host | Identity of the current process; see [host.describe](<host-describe.md>) |
| `host.log` | plugin → host | Bounded diagnostics from the current process; see [host.log](<host-log.md>) |


`host.log` and `host.describe` are the only host methods and are bound to the calling plugin process. There is no general host API: a plugin cannot read host state, open paths or call other plugins.

## Handshake

Host to plugin:

```json
{"jsonrpc":"2.0","id":1,"method":"plugin.initialize","params":{"apiVersion":1,"pluginId":"example.hello","version":"1.0.0","generation":1,"config":{},"hostVersion":"0.6.5","locale":"en-US","permissions":[]}}
```

Plugin to host:

```json
{"jsonrpc":"2.0","id":1,"result":{"apiVersion":1}}
```

Return only the supported API version. Treat identity, generation and permissions as host-owned metadata. Validate application configuration separately. The host's default handshake deadline is ten seconds. A failed initialization does not make contributions available.

## Health and invocation

```json
{"jsonrpc":"2.0","id":2,"method":"plugin.ping","params":{}}
{"jsonrpc":"2.0","id":2,"result":{}}
{"jsonrpc":"2.0","id":3,"method":"plugin.invoke","params":{"commandId":"hello","arguments":{"name":"GoNavi"}}}
{"jsonrpc":"2.0","id":3,"result":{"message":"Hello, GoNavi!"}}
```

Command IDs are local to a plugin. The host invocation API carries plugin identity separately and checks that the command is declared. Responses may arrive out of order; match IDs rather than assuming FIFO completion.

The default host heartbeat runs every second and faults after three missed probes. Keep ping and cancellation independent from command execution. Go handlers run in goroutines; TypeScript handlers must yield during asynchronous work and move CPU loops off the protocol event loop.

## Cancellation and stop

```json
{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":3}}
{"jsonrpc":"2.0","id":3,"error":{"code":-32800,"message":"request cancelled"}}
{"jsonrpc":"2.0","id":4,"method":"plugin.shutdown","params":{}}
{"jsonrpc":"2.0","id":4,"result":{}}
```

Cancellation is cooperative. It does not prove that a write was rolled back. The SDK propagates it through the request context or AbortSignal. A handler that ignores cancellation may never produce the illustrated cancellation reply. The host discards late/stale results and can terminate the process.

Disable revokes contributions and new calls before cleanup finishes. Desired state and actual process state are separate. The host permits at most two seconds of graceful process cleanup, then terminates and reaps the process tree. Generation fencing prevents a reply from an old instance from restoring contributions or completing a new-generation call. No SDK automatically retries commands or restarts a faulted process.

## SDK error codes

| Code | Meaning |
|---|---|
| `-32700` | Malformed JSON |
| `-32600` | Invalid request, invalid ID or duplicate initialization |
| `-32601` | Unknown method or command |
| `-32602` | Invalid parameters or unsupported initialization |
| `-32603` | Handler failure, panic, invalid result or oversized response |
| `-32001` | Concurrent-handler limit or duplicate active request ID |
| `-32002` | Invocation before successful initialization |
| `-32800` | Handler observed cancellation |

These are SDK implementation errors, not a new host permission API. An explicitly public SDK error can provide a safe application code and message. Ordinary exceptions become a generic failure rather than exposing stack traces, credentials or connection details.

## Manifest and package identity

A package has a root manifest named `gonavi.plugin.json`. Required fields include `schemaVersion:1`, `apiVersion:1`, `id`, `name` and a semver `version`. Declare `permissions` explicitly, usually an empty array for a standalone example. The [hello manifest template](<../../examples/plugins/hello/gonavi.plugin.json>) illustrates commands and a declarative panel; build it before checking because its executable is produced by the package tool.

Backend entries name package-relative files. A native entry runs directly, never through a shell. Node/Python entries name scripts and an explicit runtime; an absent interpreter is an error, not an automatic download. Platform entries use keys such as `windows/amd64` or `darwin/arm64`. Every declared entry must exist in the package, including platform entries not selected on this machine.

`inspect` returns a **canonical unpacked-content digest** over sorted portable paths, file lengths and content hashes. This is distinct from a marketplace artifact's **transport SHA-256**, which hashes archive bytes. Use the digest returned by local inspection for local installation. The install operation requires explicit trust and the same digest, copies/extracts into the immutable store, verifies again and installs disabled. A changed file requires another inspection and trust decision.

Inspection and static check do not execute native code, scripts, install hooks or build commands. They validate schema, entry paths and archive bounds. They do not prove that code is trustworthy or behaves correctly.

## Manifest pages and navigation

A package may declare `contributes.pages` and `contributes.navigation`. Both are optional, but declaring either requires the `ui.pages` permission. A page has an `id` (unique per array), a `title` of at most 256 bytes, and exactly one of `body` (a bounded declarative tree) or `html: {source}` (bounded UTF-8 of at most 256 KiB). A navigation entry has its own `id` and `title`, references a declared page, must use `location: "tools"`, and may set `order` within -1000..1000. Each array is capped at 32 entries. An HTML page additionally requires `ui.html-panel`. See the [pages contract](<pages.md>) for the full rules.

These declarations never travel over this stdin/stdout protocol. The host validates them at install time and renders the page in the main window. The page bridge is a separate renderer channel: an HTML page posts `{"type":"gonavi:page-call","id":…,"token":…,"method":…,"arguments":…}` to the host, which dispatches one registered capability behind the `PluginPageCall` binding and posts back `{"type":"gonavi:page-result","id":…,"ok":…,"value"|"error":…}`. The token is a random value the host generates per frame and injects into the runtime closure; a missing or mismatched token silently drops the message without a reply. Calls are limited to 30 per 10 seconds and notifications to 10 per 10 seconds. The CSP blocks page-originated requests but not self-navigation: a second frame load is treated as an escape, unmounts the frame and revokes the bridge, so data already received can still leave through navigation. Method names, permissions, argument and result limits, and failure codes are listed in the [pages contract](<pages.md>). A backend process never receives these frames and no protocol method is added for them.

## Host gateway and custom windows

For a backend process, the only plugin-to-host method is caller-bound `host.log`, and only for a live process whose package declared `host.log`. Every other host method is rejected. The SDKs do not expose arbitrary application methods. See [host.log](<host-log.md>). The page bridge in [manifest pages](#manifest-pages-and-navigation) is a renderer channel, not a backend method: a page can only call the capabilities registered for it.

A custom window does not share this stdin/stdout transport or the main application's bridge. It runs in a separate native process with a plugin-scoped bridge, bounded packaged assets and independent UI heartbeat. See the [SDK UI guide](<sdk.md#separate-custom-window>) for the public window interface and limitations. Embedded `panels[].html` is different: the host renders that declared text only inside an opaque-origin sandboxed iframe in the main window, without a bridge or external subresources. A `pages[].html` entry uses the same CSP and sandbox, but the host injects the declared page bridge (`window.gonavi`) and dispatches only the package's authorized `host.*` capabilities.
