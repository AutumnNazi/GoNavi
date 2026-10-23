# Build, package and check a plugin

Use a disposable plugin root for development. A plugin is trusted third-party code with your OS account's authority; process isolation protects application responsiveness, not files or network access from malicious code. Inspect code and permissions before granting trust.

Read the [SDK guide](<sdk.md>) and [protocol guide](<protocol.md>) before adding capabilities. SDK packages and examples are separate modules; root `go test ./...` does not include them.

## Build the real hello example

The [hello executable](<../../examples/plugins/hello/main.go>) registers a cancellable `hello` command and its [manifest template](<../../examples/plugins/hello/gonavi.plugin.json>) declares a host-rendered panel. The [package builder](<../../examples/plugins/package/main.go>) builds a native binary, selects one platform entry and writes the final manifest. It downloads no dependencies, refuses an existing output directory and retains partial output if a build fails. It is a build convenience, not a substitute for host package validation.

From the checkout root in PowerShell:

```powershell
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("gonavi-plugin-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
$package = Join-Path $work "hello-package"
$root = Join-Path $work "plugin-store"
go -C examples/plugins run ./package -output $package
```

On Unix, the equivalent setup is:

```sh
work=$(mktemp -d)
package="$work/hello-package"
root="$work/plugin-store"
go -C examples/plugins run ./package -output "$package"
```

Use `-goos linux -goarch arm64`, for example, to build another target. Build and test each advertised target; do not leave platform manifest entries pointing to absent files. This example package builder handles backend-only examples. For a custom window, explicitly copy its HTML and local assets into your package and validate the finished package.

Check the packaged output, never the source tree. A manifest template declares its entry under `backend.default`, while the finished package keeps the compiled file and a `backend.platforms` entry; a source directory therefore always fails `check` with `declared entry is not a regular package file`. Unknown manifest fields are reported by name when the name is short printable ASCII. Run the package builder first and point `check` at its output directory or the archive made from it.

## Inspect, trust, install, invoke

The following commands use a GoNavi CLI build that includes the `plugin` route. In PowerShell:

```powershell
gonavi plugin --root $root check $package
$preview = gonavi plugin --root $root inspect $package | ConvertFrom-Json
$preview.manifest | ConvertTo-Json -Depth 32
$preview.digest
# Review source, manifest and permissions before the next explicit trust action.
gonavi plugin --root $root install --digest $preview.digest --trust $package
gonavi plugin --root $root list
gonavi plugin --root $root enable example.hello
gonavi plugin --root $root invoke --args '{"name":"SDK developer"}' example.hello hello
gonavi plugin --root $root disable example.hello
gonavi plugin --root $root remove example.hello
```

The invocation result is `{"message":"Hello, SDK developer!"}`. For a long cooperative operation, pass `{"delayMillis":60000}` and a shorter `--timeout`. The timeout covers startup and invocation and cancels outstanding work; it is not a write rollback guarantee.

Every command emits JSON on stdout; failures emit JSON on stderr with a nonzero exit code. Put flags before positional arguments. Common `--root` and `--safe-mode` flags work before or after the subcommand. Without `--root`, plugins use the active GoNavi data root's plugin directory; the global `--data-root` option selects that data root.

### Command behavior

| Command | Behavior |
|---|---|
| `list` | Read installed statuses and desired state |
| `inspect PATH` | Return validated manifest, digest and package size; no execution |
| `check PATH` | Static validation with `valid:true` and inspection details; no execution |
| `install --digest HASH --trust PATH` | Install the exact reviewed package, initially disabled |
| `replace --digest HASH --trust PATH` | Swap an installed plugin for the exact reviewed package and keep its enable intent |
| `enable ID` | Persist enable intent; allow the runtime owner to start it |
| `disable ID` | Persist disable intent and revoke the instance through the owner |
| `remove [--purge] ID` | Remove the package; retain plugin data unless purge is explicit |
| `invoke [--args JSON] [--timeout 15s] ID COMMAND` | Acquire the runtime owner, wait for a desired-enabled plugin, invoke once and close |

`replace` refuses an unknown plugin, an untrusted request or a digest that does not match the package. It disables the plugin, installs the new bytes and re-enables it when it was enabled before. If installation fails the previous package is untouched, so the enable intent is restored and the old generation keeps running. Replacing with the digest that is already installed is a no-op. Safe mode refuses to replace an enabled plugin, because it cannot re-enable it afterwards; disable the plugin first.

Management commands never start a CLI runtime owner or launch installed code. They can work alongside the desktop owner's shared state. An enable receipt proves intent was persisted, not that initialization succeeded; inspect subsequent status. Safe mode preserves listing, inspection, installation, disabling and removal while refusing enable/invoke. Set `GONAVI_DISABLE_PLUGINS=1` or pass `--safe-mode`. An explicit `--safe-mode=false` cannot override that environment switch.

CLI invocation is currently **offline-owner only**: close the desktop runtime owner for the selected root first. There is no cross-process invocation broker. Acquiring the owner starts the root's desired-enabled, non-quarantined packages, not just the target. Invocation does not implicitly enable a disabled plugin or clear quarantine. It never retries a write after a timeout, crash or owner-lock error.

## Archives and distribution

Place the final manifest at archive root, not inside an extra wrapping directory. Include only the executable, runtime assets and required license material. Exclude development caches, private keys, credentials, user databases and mutable configuration. Use portable relative paths; do not package symlinks, hard links, devices or traversal entries.

For a ZIP in PowerShell:

```powershell
$archive = Join-Path $work "hello.zip"
Compress-Archive -Path (Join-Path $package "*") -DestinationPath $archive
gonavi plugin --root $root check $archive
```

The host also accepts a local directory or TGZ/tar.gz. Inspect the final archive again before installation. ZIP/TGZ transport bytes and canonical unpacked-content digests serve different purposes; see [package identity](<protocol.md#manifest-and-package-identity>). The current validator limits individual files to 64 MiB, total package contents and compressed archives to 256 MiB, and entries to 4,096. Manifest and UI/schema limits are stricter. Limits can tighten in later host releases.

Sideloading is an explicit local trust decision, not marketplace approval. Community marketplace versions require review for each release, and published version bytes cannot be replaced. A manifest's author/name is not an official-publisher badge. Publishing, authentication and deployment belong to the marketplace service; these SDK commands do not publish or contact production services.

## Failure fixtures

The [failure executable](<../../examples/plugins/failure/main.go>) and manifests under the example fixtures directory deliberately misbehave. Build them only into a temporary package and install only into a disposable root:

```powershell
$failure = Join-Path $work "ignore-cancel-package"
go -C examples/plugins run ./package -source ./failure -manifest ./fixtures/ignore-cancel/gonavi.plugin.json -output $failure
gonavi plugin --root $root check $failure
```

Choose a template:

| Template | Trigger and expected test observation |
|---|---|
| [crash](<../../examples/plugins/fixtures/crash/gonavi.plugin.json>) | `run` exits with code 23; host faults/quarantines without a restart loop |
| [hang](<../../examples/plugins/fixtures/hang/gonavi.plugin.json>) | Never initializes; host startup deadline remains bounded and disable remains available |
| [ignore-cancel](<../../examples/plugins/fixtures/ignore-cancel/gonavi.plugin.json>) | `run` never replies; ping still works, cancellation/shutdown are ignored; host must enforce stop |
| [flood](<../../examples/plugins/fixtures/flood/gonavi.plugin.json>) | `run` writes an oversized invalid stdout frame; host bounds memory and faults the process |

Each fixture has a one-minute last-resort watchdog. Tests must still own and reap it promptly; the watchdog is not an acceptable shutdown result. Verify immediate contribution revocation separately from eventual process exit. Test stale generation responses, disable while starting/stopping, and recovery by explicit user action. Never run these fixtures against production connections or a normal user plugin store.

## Permission notes

The enforced permission identifiers are listed in the [permissions reference](<permissions.md>). `permissionNotes` is optional. Each key must be one of the declared `permissions`, and each value is plain text up to 160 bytes. The install preview shows that text beside the exact permission. Notes for undeclared permissions, markup, or control characters are rejected. A note does not grant the permission. The market package check accepts the same field and rejects undeclared or markup notes.

## Local verification

Run from the checkout root with existing frontend dependencies installed:

```sh
go -C sdk/go test ./...
go -C examples/plugins test ./...
go test ./internal/cli -run TestPlugin -count=1
node frontend/node_modules/typescript/bin/tsc -p sdk/typescript/tsconfig.json
node frontend/node_modules/vitest/vitest.mjs run --root sdk/typescript --config vitest.config.mjs
```

The Go SDK tests build an independent external module in a temporary directory with module downloads disabled. They test control responsiveness during invocation/initialization, cancellation, concurrency limits, invalid requests and safe error responses. TypeScript tests cover equivalent async control behavior and bounded UTF-8 framing. The CLI tests use fake managers plus a real temporary hello package for inspection, digest-bound installation, enable, invocation and safe-mode removal.

Run `go -C sdk/go test -race ./...` where a supported cgo compiler is available. A successful non-race run is not a race-detector result. Desktop custom-window rendering, platform-specific process-tree cleanup and marketplace deployment require their own tests; SDK transport checks do not prove those integrations.
