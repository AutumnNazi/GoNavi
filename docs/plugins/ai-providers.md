# Native AI provider plugins

AI provider plugins connect an explicitly selected native backend to GoNavi chat, Agent runs and provider checks. Version 1 supports incremental text/reasoning, complete tool calls, usage and bounded image input. It does **not** support opaque upstream conversation state, automatic fallback or replay after an uncertain call.

Third-party providers ship as regular marketplace plugins: users install and enable the package themselves, and the host does not need a built-in preset or a code change. After enablement the declared providers appear in the AI settings "add model provider" list under the **plugin providers** group; the saved-provider list below it keeps the explicit configure/manage path.

The [HTTP/SSE example](<../../examples/plugins/ai-provider/main.go>) forwards requests to a configured upstream. It does not implement a model. Automated tests use local HTTP fixtures and independently compiled processes; they do not prove live model availability, quality, pricing or account access.

## Declare a provider and its models

The [example manifest](<../../examples/plugins/ai-provider/gonavi.plugin.json>) requests `ai.providers` and declares a native backend, command and static model catalog:

```json
{
  "permissions": ["ai.providers"],
  "backend": {"default": {"executable": "bin/plugin", "runtime": "native"}},
  "contributes": {
    "commands": [{"id": "provider", "title": "HTTP AI provider", "effect": "read"}],
    "aiProviders": [{
      "id": "http",
      "name": "HTTP/SSE (configured upstream)",
      "command": "provider",
      "models": [{
        "id": "gpt-4o-mini",
        "name": "GPT-4o mini (configured upstream)",
        "contextWindow": 128000,
        "maxOutputTokens": 16384
      }],
      "icon": "icons/provider.png",
      "supportsTools": true,
      "supportsImages": false
    }]
  }
}
```

This excerpt omits the package identity and command input schema; use the complete example as a template. Its provider type is exactly `plugin:sdk.examples.aiprovider:http`. Do not trim, case-fold or rewrite that namespace to OpenAI, custom or CLI when it is malformed or unavailable.

A package may declare up to **8 providers**, each with **1–32 static models**. Provider IDs are lowercase; model IDs are exact and case-sensitive. Model context limits are 1,024–262,144 tokens; output limits are 1–65,536 and cannot exceed context limits. Both capability flags are required. Set `supportsImages` to true only when the backend actually forwards images; the example keeps it false because its transport handles text only. The [contract](<ai-provider-contract.md>) defines complete identity, schema and inspection rules.

### Provider icon

`icon` is optional and names a package-relative raster image such as `icons/provider.png`. PNG, JPEG, WebP and GIF are accepted and must be at most 64 KiB. The file must exist in the package: `gonavi plugin check`, `gonavi plugin install --digest` and marketplace inspection reject a declared but missing icon. SVG is rejected; the host renders the icon in the main window and does not need an executable vector format.

The host reads the bounded file without starting the plugin, verifies the image type from its bytes, and returns a data URL in the provider catalog. The AI settings provider list and saved provider rows then show the brand logo. Missing, oversized, linked or non-raster files are omitted and the UI falls back to the provider's first letter. Inline base64 icons in the manifest are not supported; ship the file in the package.

Provider commands are reserved. Generic plugin invocation, ordinary Agent tools and plugin UI/window command menus cannot call them—even if the package also requests `ai.tools`. The host routes model operations through its private generation/digest-bound API. A model's tool-call suggestion does not execute a tool or bypass approvals.

## Build, inspect and configure

From the checkout root, in PowerShell:

```powershell
$package = Join-Path ([System.IO.Path]::GetTempPath()) ("gonavi-ai-provider-" + [guid]::NewGuid())
go -C examples/plugins run ./package -source ./ai-provider -manifest ./ai-provider/gonavi.plugin.json -output $package
gonavi plugin check $package
```

The output path must not already exist. Use the existing inspect/trust/install/enable workflow; no new installation shortcut is provided. This is a native package: the Skills-only `-static` packager mode rejects it.

After installing and enabling the package, pick the provider from the **plugin providers** group in the AI settings add-provider list (or from the configure dialog below it), choose one declared model and configure only its supported values: base URL, API key, model and allowed headers. This example requires an explicit base URL, normally ending in `/v1`, and appends `/chat/completions`. It has no default hosted endpoint and does not read API credentials or proxy configuration from the environment.

Catalog discovery uses metadata only: no implicit `/models` request, generation, enablement or runtime startup. Missing/disabled plugins and invalid saved identities remain unavailable rather than becoming another provider. Existing saved model identity and secret references are preserved until the user explicitly corrects them.

**Test Provider performs a real bounded generation against the selected endpoint.** Unlike catalog discovery or the SDK initialize handshake, that action can transmit a prompt and consume upstream quota. The automated examples below use local fixtures only.

## Go SDK: own the root lifecycle

Use one [dispatcher](<../../sdk/go/aiprovider.go>) per backend process and share its handler across reserved commands. Its instance-local `Providers` map supports multiple declarations; there is no global registry or wildcard generator.

```go
dispatcher, err := plugin.NewAIProviderDispatcher(processRoot, plugin.AIProviderOptions{
    Providers: map[string]plugin.AIProviderRegistration{
        "http": {
            Models:        declaredModels,
            SupportsTools: true,
            Generate:      upstream.generate,
        },
    },
})
if err != nil { return err }
server := plugin.NewServer(plugin.Options{
    Handlers: map[string]plugin.Handler{"provider": dispatcher.Handle},
    OnClose:  dispatcher.Abort,
})
serveErr := server.ServeStdio(processRoot)
cleanup, cancel := context.WithTimeout(context.WithoutCancel(processRoot), 2*time.Second)
defer cancel()
return errors.Join(serveErr, dispatcher.Close(cleanup))
```

The [complete entry point](<../../examples/plugins/ai-provider/main.go>) supplies the process root, static models and real HTTP transport. **Never construct a long-lived dispatcher from the initialize or start RPC context:** those contexts end when their handlers return.

`AIProviderGenerate(ctx, start, emit)` receives a dispatcher-root child context. Call `emit(AIProviderDelta{Content: ..., ReasoningContent: ...})` as upstream data arrives, honor its error, and return one `AIProviderCompletion` only when the upstream finishes. Do not buffer the entire reply before emitting, retain the emitter or launch unjoined producer work. The SDK assigns sequence numbers, validates the terminal snapshot and converts callback errors/panics to fixed safe codes.

`Abort` cancels and wakes jobs without waiting; use it in `OnClose`. It runs on EOF, read/write failure, shutdown and parent cancellation before SDK joins. `Close` performs the bounded final wait. A callback that ignores cancellation keeps its worker slot until it actually returns; the SDK does not pretend to terminate arbitrary Go code.

## TypeScript SDK

The [TypeScript dispatcher](<../../sdk/typescript/src/aiprovider.ts>) provides the same provider-bound protocol with an explicit registry:

```ts
const dispatcher = new AIProviderDispatcher({
  providers: {
    http: { models: declaredModels, supportsTools: true, generate },
  },
  rootSignal: processRoot,
});
const protocol = new Protocol({
  handlers: { provider: dispatcher.handle },
  send: writeFrame,
  onClose: dispatcher.abort,
});
// The transport owner calls protocol.close() on EOF or transport failure.
// At final shutdown, after aborting:
await dispatcher.close(cleanupSignal);
```

The generator signature is `generate(start, signal, emit) => Promise<Completion>`. Await each `emit` and join producer work before returning. Both libraries retain canceled but unfinished worker slots. Close waits are bounded: Go defaults to two seconds, TypeScript to one; helpers may lower limits. Only process isolation can stop uncooperative native/plugin code.

## Start, pull, cancel

The existing `plugin.invoke` RPC carries `{protocolVersion:1, operation, providerId, requestId, ...}`. Every operation is bound to the selected provider. The host creates a fresh 32-byte random raw-base64url request ID for each completion.

| Operation | Meaning |
| --- | --- |
| `start` | Adds selected `config` and `request`; returns `{accepted:true}` after admission, **not** after generation. |
| `pull` | Returns `{events:[...]}`, waiting at most one second. An empty array means pending, never successful completion. |
| `cancel` | Returns `{ok:true}`, cancels the job and clears output. Unknown IDs leave a bounded provider-local tombstone against a late start. |

Only one consumer may pull a completion. Consumed/expired/unknown sessions fail explicitly. Never retry a consumed or ambiguous batch, restart the same completion or silently bind to a new plugin generation. The host attempts bounded cancellation on every exit, including a failed start.

Events have positive contiguous `sequence` numbers beginning at 1:

- `delta`: nonempty `content` and/or `reasoningContent`.
- `done`: `finishReason` of `stop`, `tool_calls` or `length`; optional complete `toolCalls` and `usage`.
- `error`: only `canceled`, `deadline`, `unsupported`, `invalid_request`, `generation_failed` or `limit_exceeded`. Never include raw upstream errors, bodies, URLs or credentials.

A terminal event or explicit failure must settle the operation. Partial text followed by interruption is not success. A `length` terminal may retain complete, validated tool calls; incomplete argument fragments remain invalid. The host reports a known output limit only when requested, without treating it as a transport retry. Tool calls are complete snapshots, not argument fragments; names must have been offered, IDs must be unique and arguments must be valid JSON objects. Host policy still decides whether to execute them.

## Budgets and cancellation

| Boundary | Maximum |
| --- | --- |
| Admitted workers / retained session records | 16 each, shared across the registry |
| Queued events / encoded bytes per completion | 64 / 512 KiB; terminal space is reserved |
| Encoded event / encoded pull result | 64 KiB / 128 KiB; at most 16 events per pull |
| Whole completion | 8 MiB encoded events, 65,536 events, five minutes |
| Active idle lease | **30 seconds without a valid pull**; pending empty pulls renew it |
| Start/request envelope | 512 KiB text-only; 32 MiB when images are declared, JSON depth 32, bounded nodes and 512 messages |
| Image parts | 4 per user message, 4 MiB decoded each, 24 MiB encoded per request; base64 `data:` URLs only |
| Offered tool definitions / returned tool calls | **128 / 64** |
| Returned tool-call JSON / one argument string | 48 KiB total / 32 KiB |

The idle lease uses active timers: it cancels the worker context and clears output even if the host disappears or its callback stalls without issuing another request. Canceling never frees a still-running callback's slot. Finished but unread output also remains within the 16-record cap and expires.

Oversize output produces a sticky failure; ignoring an emitter error cannot turn that result into a normal `done`. Bounds are independent of model token limits. Zero request `maxTokens` selects the declared output cap; a lower host-configured cap remains lower. Images on a provider that does not declare `supportsImages`, non-user images, remote image URLs and malformed base64 are errors, not silently discarded options. The same applies to opaque state, CLI/API-format/thinking fields and forbidden transport headers.

## HTTP/SSE example and tests

The [transport](<../../examples/plugins/ai-provider/http.go>) sends selected configuration only, disables redirects, does not retry/fail over and propagates the job context through HTTP and SSE reading. The [parser](<../../examples/plugins/ai-provider/stream.go>) accepts one explicit choice at `index:0`, emits text/reasoning as chunks arrive, accumulates bounded tool fragments and requires a valid finish reason plus `[DONE]` and stream end. It rejects malformed/trailing data instead of fabricating success. Usage is absent when upstream usage is absent, not invented as zero.

The example additionally bounds raw upstream data to 16 MiB and each SSE line/event to 128 KiB. Its static model entry is configuration metadata, not a claim that a live endpoint or account was tested.

```powershell
go -C sdk/go test ./...
go -C sdk/go vet ./...
node frontend/node_modules/typescript/bin/tsc -p sdk/typescript/tsconfig.json
node frontend/node_modules/vitest/vitest.mjs run --root sdk/typescript --config vitest.config.mjs
go -C examples/plugins test ./ai-provider
go -C examples/plugins vet ./ai-provider
```

Local regressions cover early chunks before completion, reasoning/tools/usage, request projection, redirect denial, cancellation reaching HTTP, malformed EOF, no replay, worker/session caps, backpressure, idle expiry and SDK shutdown. [Subprocess tests](<../../examples/plugins/ai-provider/process_test.go>) compile and run the independent native example; they are not live inference tests. Run race-enabled tests in a C-toolchain-enabled environment; non-race tests do not establish race-detector coverage.

## Trust and revocation

Only the selected provider's decrypted key, allowed headers, model and request are projected to its plugin. Other providers' keys, token references, CLI environment and hidden host settings are not forwarded. Never log selected configuration or upstream response/error bodies.

Bindings pin the plugin version, digest and generation. Disable, removal, restart, update or root change makes old operations fail rather than reconnect or replay. Built-in provider restrictions and existing provider behavior remain unchanged.

**Trusted native code is not an OS sandbox.** Configuration projection, manifest permissions and declared capabilities do not prove that malicious code is safe. Review and trust the package before enabling it. Model output and tool suggestions do not acquire host authority.
