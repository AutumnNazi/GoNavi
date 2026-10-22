# Data-source extension contract

This additive contract connects SQL-family plugins to the real Database path. Protocol v1 remains read-only. Protocol v2 adds single-statement `exec` and explicit plugin-managed transactions for sources that declare `readOnly:false`. It does not claim batch execution, streaming, imports, SSH, custom proxy forwarding or arbitrary engine support. Native plugins remain trusted code, not a sandbox. Existing built-in drivers and their policy behavior must remain unchanged.

## Manifest and identity

- Explicit permission: `data.sources`.
- `contributes.dataSources`: at most 8 objects `{id,name,dialect,command,defaultPort?,readOnly}`. IDs are unique lowercase strings matching ^[a-z][a-z0-9_.-]{0,63}$; colon is forbidden because Type uses it as a separator. Dialect is exactly `mysql|postgres|sqlite`. Command must already exist in contributes.commands; backend must exist. `readOnly` is required and must be a boolean. `true` keeps the v1 read-only contract; `false` opts into v2 writes and transactions and must be an explicit, reviewed declaration. A read-only source's command effect must be omitted, `read`, or `unknown`.
- Canonical connection Type: `plugin:<manifest.id>:<dataSource.id>:<dialect>`. The immutable dialect suffix makes safety/quoting classification available even when a plugin is absent; it is NOT factory aliasing to a built-in driver. The selected runtime must validate all identity components against the actual manifest. Malformed, disabled, missing and stale types fail closed, never fall back to MySQL.
- Runtime exports `DataSource`, `DataSourceType(pluginID string, source DataSource) string` and `ParseDataSourceType(value string)(pluginID,sourceID,dialect string,ok bool)`. The Type prefix must be preserved by frontend sanitizers even when currently unavailable.

## Driver protocol

Use the declared command through host-only `Manager.InvokeDataSourceGeneration(ctx, pluginID, generation, sourceID, args)`. Commands referenced by dataSources are reserved: ordinary Invoke/InvokeGeneration, generic UI/independent-window invocation and Agent command catalogs must not expose them. The wire message remains plugin.invoke; only the trusted host connection adapter may select the datasource entrypoint. This keeps raw session/config/query envelopes behind host credential resolution and SQL protection. Args v1: `{protocolVersion:1,operation,sessionId,config?,database?,table?,query?}`. Args v2 adds `transactionId?` and is used only for `exec`, `begin`, `commit`, `rollback` and transaction-scoped `query`. Session ID is host-generated, unguessable and tied to one adapter/generation; never silently reconnect/replay on new generations. Connect gets only the selected connection's necessary host/port/user/password/database/connectionParams fields, NOT arbitrary host config, saved connection inventory, proxy/SSH credentials or unrelated secrets.

- `connect|ping|close` => `{ok:true}`.
- `query` => `{rows:object[],fields:string[]}`; bounded by runtime IPC and an explicit adapter row/column budget. Unsupported/oversize/malformed replies are errors, not fake empty success.
- `databases|tables` => `{names:string[]}`.
- `createStatement` => `{statement:string}`.
- `columns|allColumns|indexes|foreignKeys|triggers` => named array matching existing connection DTO JSON fields (copy these wire shapes into the public SDK, never import host internal packages).
- v2 `exec` (transactionId,query) => `{ok:true,rowsAffected:number}` for one statement. `begin` () => `{ok:true,transactionId:string}`; the host validates an opaque 1-128 character `[A-Za-z0-9_-]` handle. `commit`/`rollback` (transactionId) => `{ok:true}`; transaction-scoped `query` keeps the v1 query shape. Read-only sources reject `exec`/`begin` in the adapter before dispatch, even if a forged connection config disables protection.
- Transaction calls on one session are serialized by the host. A handle is single-use, is never reused after commit/rollback, and rollback on close is idempotent. Plugins own the underlying transaction and must release it on session close. Unknown outcomes must be surfaced as errors, not retried blindly.
- Every operation is context-cancellable and generation-fenced both before and after dispatch. Do not replay unknown outcomes.
- Batch writes and unsupported transport extras are explicitly rejected. Host read-only SQL classification and connection protection are injected into the adapter; missing validators fail closed. Keep production confirmation, query audit and saved credential resolution paths.

## Host adapter / UI handoff

- New `db.NewPluginDatabase(manager *plugin.Manager,status plugin.Status,source plugin.DataSource,validateReadOnly func(string) error)(*PluginDatabase,error)`. Implement Database, QueryContexter, ColumnDefinitionContexter, ExecContexter and the host transaction provider. Read-only instances fence those optional paths at runtime. `PluginWritable` on the connection is only a host-verified policy/UI hint; the adapter's immutable `source.ReadOnly` check remains authoritative. Use existing metadataContextFor for isolated metadata requests. Add optional freshness accessor for cache eviction; no hot mutation of the global db factory map.
- Package helper functions in app intercept BOTH current database factory seams while retaining old test seams for built-ins. Cache keys include runtime generation; disabled/missing plugins cannot reopen or reuse stale sessions.
- Metadata temporary Apps borrow the owner's plugin resolver/runtime via an owner pointer, never copy a mutex or start a competing runtime.
- `App.PluginDataSources() connection.QueryResult` returns `{items:[{type,pluginId,id,name,dialect,defaultPort,version,generation,available,connectable,state,readOnly,reason?}]}`. Installed-but-disabled entries remain visible with available=false and connectable=false. available means currently running in the locally owned runtime. connectable means an explicit connection attempt is eligible: approved declaration + desired enabled + not faulted/blocked/stopping/safe-mode; starting or a desired-enabled stopped runtime may be connectable without being available. state/reason expose that distinction. A known competing execution owner is not advertised as available. This discovery method does not start plugins. An explicit connect may attempt ownership and boundedly await startup, then capture the actual current generation; it fails cleanly if another owner holds the lease. Built-in/read-only catalog operations do not activate code.
- Frontend dynamic snapshot stays in a separate feature module, not the oversized root store. Static registry remains immutable; dynamic getters can overlay validated namespaced descriptors. Preserve unknown plugin Type and read-only protection while disabled/uninstalled. Do not present optional-driver installation or JDBC controls for plugin types.
- Query/metadata and cancel capabilities require availability. Transactions require availability plus `readOnly:false`; all import/DDL-designer/other mutation capabilities stay false. Saved connections without the host-verified writable hint keep full protection. User-facing additions go to all six locales. Do not hand-edit Wails bindings.

## Ownership

Runtime/manifest validation + matching public manifest types: plugin-runtime.
Database adapter + adapter tests only: plugin-window.
Host factory/lifecycle/policy/catalog integration: plugin-sdk.
Frontend dynamic registry, selector and safety gates: plugin-ui.
Public driver DTO/handler helper and an independently runnable example + docs: market-client.
Lead: contract coordination, IPC timing regression, generated artifacts, review and integration verification.
