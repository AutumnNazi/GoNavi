# Opt-in Agent tools

A trusted plugin can expose its declared commands to GoNavi's Agent by including `ai.tools` in manifest permissions:

```json
"permissions": ["ai.tools"]
```

The [hello manifest](<../../examples/plugins/hello/gonavi.plugin.json>) opts in. Inspect the rebuilt package and approve its new digest before installing it. This permission exposes **all declared commands** of that plugin; omit it when commands should be available only through manual invocation or UI buttons.

## Discovery and ownership

Only desired-enabled, running plugins with this exact permission appear in the Agent tool catalog. Safe mode, disable, startup failure and quarantine remove their live tools. The adapter borrows the application's existing locally owned runtime; catalog lookup never starts a process or claims a desktop owner's lease. The CLI requests activation only when constructing an Agent execution-worker owner. Read-only Agent list/show/control commands and ordinary headless database commands do not activate plugins.

A standalone CLI does not proxy tool calls to another GUI runtime owner. Use the Agent in that owning application, or close the owner before starting a local Agent worker. A catalog snapshot from a nonowner omits plugin tools rather than claiming another process's execution lease.

A first Agent snapshot can race an opted-in backend's handshake. Discovery waits at most ten seconds for already-starting opted-in plugins, honors the caller's cancellation and then omits unavailable entries. Built-in database and workspace tools remain available when the plugin runtime is absent. Read-only management does not create a runtime merely to discover tools.

Tool names use a reserved `plugin__` prefix and a hash of the original plugin/command IDs. Names remain stable across installations and avoid lossy name-normalization collisions. The descriptor preserves the command's JSON input schema and identifies the originating plugin and command in its description.

## Approval and execution

The plugin receives only the command arguments, not the full Agent workspace snapshot or saved connection credentials. The permission does not create a general host gateway.

Every plugin tool has the conservative `side_effect_unknown` effect, even if its manifest command claims `read`. Trusting native code is not proof that a command is read-only. The Agent's existing approval policy applies; this adapter does not approve calls or lower their effect.

The Agent freezes each descriptor when it accepts a run. Plugin descriptors include the installed content digest and exact runtime generation. Disable/re-enable, package replacement or schema changes invalidate the old descriptor. Execution checks the live descriptor again and calls `InvokeGeneration`, never the unconstrained latest-generation invocation. A previously approved tool call cannot silently switch to a replacement process.

Invocations propagate the Agent context, use a 30-second descriptor deadline and bound JSON results to one MiB. A cancellation, crash or fenced response after dispatch has an **unknown outcome**: the plugin may already have made an external change. The adapter reports that uncertainty and does not retry the command. Generic execution errors omit arbitrary plugin diagnostics from the model's error text.

## Scope

This is native plugin-command exposure through the existing Agent catalog. It is not automatic forwarding to external MCP clients, an unrestricted host API, a database driver contract or a data-source adapter. Existing database tools keep their own SQL inspection, read-only checks, approval and audit paths.

Public SDKs and package development remain described in the [SDK guide](<sdk.md>) and [development guide](<development.md>). The tool adapter adds no plugin wire method: it uses the existing `plugin.invoke` and cancellation protocol.

## Verification

```sh
go test ./internal/mcpserver -run TestPluginTool -count=1
go test ./internal/cli -run 'TestPlugin|TestAgentToolCatalog' -count=1
```

The catalog tests use fake descriptor data and temporary, locally built example executables. They verify explicit opt-in, unknown effects, collision-resistant names, immutable generation/digest descriptors, actual invocation, disabled executors, re-enable fencing, cancellation outcomes and bounded startup discovery. They do not call a live model, external MCP server or production data source.
