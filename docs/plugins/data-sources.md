# Data-source plugins

This data-source contract connects a trusted plugin process to GoNavi's query, metadata, write and transaction paths. It supports the SQL dialect labels **mysql**, **postgres** and **sqlite**. Sources default to the v1 read-only contract; an explicit `"readOnly": false` opts into the v2 `exec`, `begin`, `commit` and `rollback` operations. A dialect label controls host safety and quoting; it does not turn a plugin into a built-in driver or implement an SQL engine.

The [read-only fixture plugin](<../../examples/plugins/read-only-database/main.go>) serves three in-memory records through a documented SELECT subset. It uses no database dependency or external service. It is a runnable v1 protocol example, **not a SQLite implementation**. The [writable fixture plugin](<../../examples/plugins/writable-database/main.go>) adds a bounded UPDATE and explicit begin/commit/rollback on the same mutable dataset; it is the v2 protocol example.

## Declare a data source

Add the explicit `data.sources` permission, a backend command and a data-source contribution. See the [complete example manifest](<../../examples/plugins/read-only-database/gonavi.plugin.json>):

```json
{
  "permissions": ["data.sources"],
  "contributes": {
    "commands": [{"id": "database", "title": "Read fixture database", "effect": "read"}],
    "dataSources": [{
      "id": "fixture",
      "name": "Read-only fixture (SQL subset)",
      "dialect": "sqlite",
      "command": "database",
      "readOnly": true
    }]
  }
}
```

This fragment belongs inside a complete v1 manifest with a backend. A plugin may declare at most eight data sources. Each source ID starts with a lowercase letter and contains at most 64 lowercase letters, digits, underscores, dots or hyphens. The command must exist in the manifest. `readOnly` is required; omit writes by declaring `true`, or opt in with `false` only after implementing the v2 write and transaction operations. A read-only source's command effect must be omitted, `read`, or `unknown`. Generic `plugin invoke`, desktop `PluginInvoke`, and the Agent tool catalog cannot call that command; only the host-managed connection path may dispatch it.

The example's connection type is `plugin:sdk.examples.readonly:fixture:sqlite`. The host validates every component against the installed manifest. Missing, disabled and stale plugin types remain namespaced; they never become MySQL connections.

## Implement the driver command

The independent [Go DTOs](<../../sdk/go/datasource_types.go>) and [TypeScript DTOs](<../../sdk/typescript/src/datasourceTypes.ts>) copy the host's public wire shapes without importing host internals. Register the [Go dispatcher's](<../../sdk/go/datasource.go>) `Handle` method or the [TypeScript dispatcher's](<../../sdk/typescript/src/datasource.ts>) bound `handle` callback under the manifest command.

Go:

```go
dispatcher := plugin.NewDataSourceDispatcher(providerOperations)
server := plugin.NewServer(plugin.Options{
    Handlers: map[string]plugin.Handler{"database": dispatcher.Handle},
})
```

TypeScript:

```ts
import { DataSourceDispatcher, Protocol } from '@gonavi/plugin-sdk';

const dispatcher = new DataSourceDispatcher(providerOperations);
const protocol = new Protocol({ handlers: { database: dispatcher.handle }, send });
```

Here `providerOperations` contains your typed callbacks; `send` is the existing protocol transport. Implement resource cleanup in the provider's close callback, and call the dispatcher's lifecycle `Close(ctx)` / `close(signal)` when the process or protocol stops. The [runnable Go entry](<../../examples/plugins/read-only-database/main.go>) shows bounded shutdown cleanup. TypeScript callers must observe the cleanup promise, report only a constant diagnostic on failure and avoid unhandled rejections.

Callbacks may run concurrently. Keep provider sessions separate by host-supplied `sessionId`; never reuse a global connection for unrelated credentials. The selected config contains only `host`, `port`, `user`, `password`, `database` and optional `connectionParams`. The helper rejects arbitrary extra config fields. Never log the config, raw arguments, connection strings or callback errors that may contain secrets. Ordinary callback errors become generic protocol errors; explicitly public SDK errors must contain safe messages.

### Wire results

The driver command is **host-reserved**: the host data-source adapter authorizes it through the connection/query path, then sends `plugin.invoke` on the child pipe. Generic plugin invocation, CLI `plugin invoke`, Agent tools, declarative buttons and plugin-window bridges cannot call a reserved driver command. The unchanged wire method is not a bypass. Its arguments are:

```json
{"protocolVersion":1,"operation":"tables","sessionId":"host-generated-base64url-token","database":"fixture"}
```

Only `connect` accepts `config`. Table operations use `table`; `query` uses `query`. The host generates a random 32-byte session token encoded as 43 base64url characters. Helpers accept bounded URL-safe IDs up to 128 characters, not a UUID-only format.

| Operation | Callback result / wire envelope |
| --- | --- |
| `connect`, `ping`, `close` | Callback succeeds without a value → `{"ok":true}` |
| `query` | `{"rows":[{"id":1}],"fields":["id"]}` |
| `databases`, `tables` | String array → `{"names":[]}` |
| `createStatement` | Nonempty string → `{"statement":"CREATE TABLE ..."}` |
| `columns` | Column-definition array → `{"columns":[]}` |
| `allColumns` | Table/name/type/comment array → `{"allColumns":[]}` |
| `indexes` | Index-definition array → `{"indexes":[]}` |
| `foreignKeys` | Foreign-key array → `{"foreignKeys":[]}` |
| `triggers` | Trigger-definition array → `{"triggers":[]}` |

Use the DTOs rather than inventing field names. In particular, `allColumns` does not return the `columns` envelope; column defaults use `null` when absent. A missing callback returns an unsupported-operation error. A missing/null array is an error; return an explicit empty array for a supported operation with no results.

The helper bounds query results to 10,000 rows and 512 fields, metadata arrays to 10,000 entries, query text to 256 KiB and serialized result values to 1 MiB. The surrounding IPC frame limit can reject a result close to that byte limit because framing adds overhead. Host limits remain authoritative. Streaming and implicit truncation are outside this slice.

Use `int64`, `json.Number` or strings for precise Go integers. The Go helper emits values outside JavaScript's safe integer range as strings. In TypeScript, return `bigint` cells or decimal strings; the helper converts `bigint` to strings and rejects unsafe integer-valued `number` cells. Neither helper can recover precision already lost by a database driver or JavaScript conversion. Use strings for exact decimal values too.

### Cancellation and ownership

Pass every callback's context or AbortSignal into underlying I/O. `close` immediately revokes the session and cancels active calls before provider cleanup. A connect callback that returns late cannot publish an open session; the dispatcher invokes the provider close callback again with a fresh two-second cleanup deadline. Therefore, close callbacks must be idempotent and must tolerate a session that never finished connecting.

The dispatcher permits 128 active sessions, retains 4,096 recent settled tombstones and preserves closed records whose connect/query callbacks remain in flight. Old settled tombstones are evicted; host-generated session IDs must never be reused. Ordinary metadata traffic does not exhaust a lifetime session quota. Providers own their resources; the dispatcher guards identity and cancellation, not resource implementation.

No helper retries or reconnects an uncertain operation. Cancellation is cooperative: a callback that ignores its context/signal may outlive cleanup deadlines until the host terminates the plugin process. CPU-bound JavaScript must yield or use a Worker. Native code and Workers still have the user's OS authority; this mechanism is not a sandbox.

## Build and run the fixture

From the checkout root in PowerShell, with Go already installed:

```powershell
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("gonavi-datasource-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
$package = Join-Path $work "readonly-package"
go -C examples/plugins run ./package -source ./read-only-database -manifest ./read-only-database/gonavi.plugin.json -output $package
gonavi plugin check $package
```

On Unix:

```sh
work=$(mktemp -d)
package="$work/readonly-package"
go -C examples/plugins run ./package -source ./read-only-database -manifest ./read-only-database/gonavi.plugin.json -output "$package"
gonavi plugin check "$package"
```

Inspect the generated package before trusting it. Install it through GoNavi's local plugin manager, enable it, then select **Read-only fixture (SQL subset)** in the connection selector. Use host `memory` or an empty host, port `0`, database `fixture` and no connection parameters. Leave user and password blank: the fixture performs no authentication, ignores those two fields, and never stores or logs them. Hostnames other than `memory`, nonzero ports and extra connection parameters fail instead of pretending to contact a server.

The fixture exposes database `fixture` and table `people`. Its columns are `id`, `name` and `score`; rows are Ada, Grace and Lin. Ada's score is the exact string `9007199254740993` after SDK normalization.

Supported statements, case-insensitively, with optional final semicolon:

- `SELECT 1` or `SELECT 1 AS value`.
- `SELECT * FROM people` or `SELECT id, name FROM people`; `"people"` quoting is also accepted.
- Either table projection may append `LIMIT n` or `LIMIT n OFFSET m`, with nonnegative integers of at most five digits.
- `SELECT COUNT(*) AS count FROM people`, without pagination.
- `SELECT sleep_ms(n)`, for cancellation testing with `0 <= n <= 5000`.

Other queries fail, including writes, joins, filters, CTEs, comments and multiple statements. Metadata describes the fixed dataset; empty foreign-key and trigger arrays reflect that fixture, not advertised support for an external engine. Use the real host connection/query path to exercise connect/query/close; generic CLI invocation of this reserved command is rejected. Independent subprocess tests exercise the plugin-side protocol directly, not an alternate authorized host API.

## Verify independently

The SDK and examples are nested modules. Root Go tests do not include them:

```sh
go -C sdk/go test ./...
go -C sdk/go vet ./...
go -C examples/plugins test ./read-only-database ./writable-database
go -C examples/plugins vet ./read-only-database ./writable-database
node frontend/node_modules/typescript/bin/tsc -p sdk/typescript/tsconfig.json
node frontend/node_modules/vitest/vitest.mjs run --root sdk/typescript --config vitest.config.mjs
```

The [Go contract tests](<../../sdk/go/datasource_test.go>) and [TypeScript tests](<../../sdk/typescript/test/datasource.test.ts>) cover envelopes, metadata shapes, number precision, invalid arrays, cancellation, late connect and bounded tombstone retention. The [real subprocess test](<../../examples/plugins/read-only-database/process_test.go>) builds with module downloads disabled, initializes the child, connects, reads rows and metadata, rejects a write, cancels a slow query while heartbeat stays responsive, closes the session and reaps the process. The writable fixture's in-process test drives begin, exec, rollback, commit and persistence without any external database; the host integration test builds the package and verifies the app-level transaction path.

## Writable example

Build and inspect the writable package the same way, replacing `read-only-database` with `writable-database`. Select **Writable fixture (SQL subset)** with explicit writable opt-in in the connection editor. It supports `UPDATE people SET name = 'New' WHERE id = N` inside an active transaction, plus `begin`, `commit` and `rollback`; ordinary `SELECT` remains available through protocol v1. Commit persists the name, rollback restores the previous rows, closing the session rolls back unfinished transactions, and any other statement fails. It is a teaching fixture, not a general SQL engine.

Writable execution is never implied by installing a plugin. The connection must be configured for editing, the manifest must declare `readOnly:false`, and the host still classifies SQL and applies its connection protection. Read-only sources remain rejected at the adapter even if a caller forges a writable request.

This verification uses no production service or database. It does not prove every host/UI integration or OS process-tree behavior. Run the host adapter/lifecycle tests separately. Local race-detector coverage requires a supported cgo compiler; a non-race test run is not a race-detector result.

## Scope boundaries

Protocol v1 provides read-only queries and metadata. Protocol v2 adds one-statement `exec` and explicit plugin-managed transactions for writable sources. It deliberately omits batch execution, imports, streaming, SSH, custom proxy forwarding, TLS-option forwarding and arbitrary engine support. Read-only sources are fenced in the adapter before dispatch, and the host rejects unsupported transport options and enforces its SQL classification and connection protection. Plugins must implement their own truthful SQL subset and underlying transport. Existing built-in drivers keep their own behavior.

**Native plugin trust is not database-server read-only enforcement.** A trusted native plugin can ignore host intent and act with the selected credentials. For real databases, use a server-enforced read-only account with the minimum grants needed; the manifest flag and host SQL classifier do not replace those grants.

Read the [data-source contract](<data-source-contract.md>), [SDK guide](<sdk.md>) and [packaging guide](<development.md>) before extending this slice. Publication review, host capability policy and production deployment are separate work.
