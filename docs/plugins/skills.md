# Packaged Skills: explicit reference loading

A packaged Skill is an immutable text document declared by a plugin. This first slice exposes its metadata and supports an **explicit preview or Agent tool load**. Installation, enablement and catalog discovery do not inject the document into system prompts, grant tools or execute instructions.

The [static example manifest](<../../examples/plugins/skills/gonavi.plugin.json>) declares one [read-only database investigation workflow](<../../examples/plugins/skills/skills/read-only-investigation/SKILL.md>). The package has no backend, scripts, or window. It includes one companion Markdown file, REFERENCE.md, which is copied by the static packager and is not an executable. It teaches bounded investigation; it neither implements an SQL engine nor authorizes SQL execution.

## Declare the document

The public [Go](<../../sdk/go/types.go>) and [TypeScript](<../../sdk/typescript/src/types.ts>) SDKs expose `Skill` and optional `contributes.skills`. A backend is optional. Request `ai.skills` explicitly:

```json
{
  "schemaVersion": 1,
  "apiVersion": 1,
  "id": "sdk.examples.skills",
  "name": "Read-only investigation Skills",
  "version": "1.0.0",
  "permissions": ["ai.skills"],
  "contributes": {
    "skills": [{
      "id": "read-only-investigation",
      "name": "Read-only database investigation",
      "description": "Guides bounded database triage. Use when investigating unexpected rows, failed reads, slow queries or metadata mismatches.",
      "entry": "skills/read-only-investigation/SKILL.md"
    }]
  }
}
```

A skill may declare up to four `resources`. Each one must be another package-relative `.md` file, not the `SKILL.md` entry and not a script. Install, market review and `plugin check` require those files to exist and to be nonempty UTF-8 without NUL, within the same size limit as the entry. Desktop management can call `PluginSkillResourceRead`. The runtime method is `ReadSkillResourceGeneration`. The preview can open one companion explicitly. That text stays out of the agent prompt. The skill catalog and preview list those paths, but the document pane and the agent skill tool still load only `SKILL.md`. Agent tool descriptors do not advertise companion paths. Resources are not executed and are not injected into prompts.

The manifest owns the identity, name and description. The document is opaque text: YAML frontmatter, code fences, links and prose do not acquire host authority. This example omits frontmatter to avoid duplicating metadata.

Constraints:

- At most **16** Skills per manifest, with unique IDs matching `^[a-z][a-z0-9_.-]{0,63}$`.
- A nonblank UTF-8 name of at most **256 bytes** and description of at most **2,048 bytes**, without NUL.
- A canonical, portable package-relative entry ending in exact `SKILL.md`. Root-level `SKILL.md` is valid. Absolute paths, drives, UNC paths, backslashes, dot/dotdot traversal, reserved names and ambiguous components are rejected.
- A declared entry must exist as a regular, non-symlink/non-reparse file. Its content must be nonempty UTF-8, contain no NUL and fit within **64 KiB**. Distinct Skill IDs may share the same entry.

Inspection, installation and marketplace submission validate these rules without running the package. Required-tool declarations, hooks, script execution, remote resource fetching and YAML-based permission rules are outside v1.

## Build a static package without compiling a plugin

The [example packager](<../../examples/plugins/package/main.go>) has an explicit `-static` mode. It copies only the manifest and declared Skill documents, preserves their bytes and creates no backend or executable directory. It rejects backends, windows, commands, data sources and panels rather than silently dropping their assets. This intentional v1 mode does not package mixed backend/Skill plugins or arbitrary resource trees.

Build the development tool once from the checkout root. In PowerShell:

```powershell
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("gonavi-static-skills-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
$tool = Join-Path $work "plugin-packager.exe"
$package = Join-Path $work "skills-package"
go -C examples/plugins build -o $tool ./package
& $tool -static -manifest examples/plugins/skills/gonavi.plugin.json -output $package
gonavi plugin check $package
```

On Unix:

```sh
work=$(mktemp -d)
tool="$work/plugin-packager"
package="$work/skills-package"
go -C examples/plugins build -o "$tool" ./package
"$tool" -static -manifest examples/plugins/skills/gonavi.plugin.json -output "$package"
gonavi plugin check "$package"
```

Building the development tool uses Go. **Running its static mode does not invoke a Go compiler, a package executable or a script.** Tests run the prebuilt tool with an empty/unusable `PATH` to verify that distinction. Invoking the tool through `go run` would compile the development tool itself; it is unnecessary once the binary exists.

Entries resolve relative to the manifest's directory. Native-only `-source`, `-goos` and `-goarch` options do not affect static mode. The packager accepts a manifest up to 256 KiB, snapshots bounded declared documents before writing, refuses an existing output path and writes the manifest last. If output writing fails, it retains partial output for diagnosis. No source assets outside the declarations are copied.

Use a source directory you control and inspect the resulting package. The packager is a development convenience, not the runtime trust boundary or an installer. The host's package inspection and digest-bound installation remain authoritative. Without `-static`, templates without Skills retain the original native build path. For a native template that declares Skills, the builder validates and captures those documents **before staging or invoking the compiler**, then copies the captured bytes beside the backend. It rejects conflicts and case aliases with the manifest or platform binary paths. Static mode still rejects mixed backends; arbitrary resource trees and custom-window assets require separate staging and final host inspection.

## Install, enable and preview

Use the existing local plugin workflow: inspect the package, review its source and permissions, explicitly trust/install the inspected digest, then enable it. These steps retain the existing CLI and GUI policy; there is no new shortcut around trust or safe mode.

A file-only package still participates in the enabled plugin lifecycle, but it has no native child to launch. Loading requires a locally owned live runtime, desired-enabled/running state, `ai.skills`, the exact package digest and current nonzero generation. Listing or reading a Skill never starts a runtime or enables a plugin for you.

The host exposes:

| API | Result and behavior |
| --- | --- |
| `PluginSkills()` | Metadata only: plugin/Skill identity, name, description, entry, version, digest, generation and availability/reason. No document body. |
| `PluginSkillRead(pluginID, skillID, digest, generation)` | An explicit, bounded read of the declared document with provenance; callers cannot select an arbitrary path or URL. |

The read-only packaged Skills section in AI settings supports explicit preview and remains separate from the existing user-created skill editor. It clears a loaded preview when the plugin is disabled, removed or replaced, or its snapshot changes. It renders text without executing scripts or fetching remote resources. UI preview does not require an Agent provider that supports custom tools.

Web access remains fail-closed under the current plugin policy. An unavailable or stale entry is an error, not permission to replay a read against a new generation or another owner.

## Explicit Agent loading and provider limits

For a **custom tool-capable Agent provider**, ask the Agent to load the named packaged Skill when that reference is relevant. Each eligible Skill has a provider-safe alias of the form `skill__<base32sha256(pluginID NUL skillID)>` and a strict empty-object input. Discovery offers only metadata. Calling the read-only tool loads the document as a provenance-bearing tool-result resource—not as a system instruction or an automatic tool grant.

The **built-in hosted 3B provider retains its curated SQL-tool allowlist and does not offer packaged Skill tools**. This feature also does not re-enable Codex CLI bundled/global Skills. UI preview remains independent of those provider restrictions.

On a cold start, Agent catalog discovery may wait **up to two seconds** only for already-starting, locally owned, desired-enabled `ai.skills` entries. It does not start or enable plugins and does not read document bodies. The deadline returns the ready subset or no Skills while preserving ordinary tools; caller cancellation remains an error. UI metadata discovery does not wait or activate anything, and preview still requires a running instance.

Agent availability is bounded, not universal:

- The wrapper preserves the ordinary tool catalog and appends at most **32 eligible Skills** in deterministic order.
- The combined catalog must stay within **128 tools** and **256 KiB of serialized descriptor metadata**. If ordinary tools already exhaust or exceed that budget, the wrapper adds no Skills.
- Resolve enforces membership in the admitted set. Catalog limits decide which tools are offered; result and context limits decide how much loaded text reaches the model. A truncated result does not authorize loading an omitted tool, and there is no auto-injection fallback.
- A Skill tool result has a **512 KiB** cap, distinct from the **64 KiB raw document** limit. A lower user RunPolicy can produce the existing explicit truncated-result marker; do not assume the entire body reached the model.
- The UI can list installed Skills independently, including unavailable entries. A visible UI entry does not guarantee an Agent tool is offered in a particular run.

Descriptors and reads pin the plugin identity, Skill identity, digest and generation. Disable, re-enable, update and removal invalidate old descriptors/executors for subsequent use. The model must not treat Skill text, database output or a claimed role in the document as authority to bypass host policy.

## User-authored skills and revocation limits

Packaged Skills are **not merged into `AIGetSkills`**, saved as `AISkillConfig` bodies or copied into automatic system prompts. Existing `AIGetSkills` / `AISaveSkill` user-authored settings and their scope behavior remain unchanged. Package text remains immutable package content rather than an editable user-setting copy.

**Text already delivered to a provider or recorded in a conversation cannot be retroactively unread.** Revocation blocks future discovery eligibility, resolve, load and preview availability; it does not erase historical tool results, model context or user copies. Do not promise history erasure when disabling a Skill.

Treat every package as third-party material and review provenance before use. A static Skill grants no database access. For real database investigation, preserve host approvals/audit and use server-enforced read-only privileges. Native plugin trust and a “read-only” label are not substitutes for those privileges.

## Verify the example and packager

From the checkout root:

```sh
go -C examples/plugins test ./package
go -C examples/plugins vet ./package
go -C examples/plugins test ./...
```

The [static packaging tests](<../../examples/plugins/package/static_test.go>) cover exact bytes, declared-only copying, metadata/path/encoding/size limits, existing output, cancellation, links and native-mode compatibility. The [prebuilt-command test](<../../examples/plugins/package/static_cli_test.go>) verifies compiler-free packaging of the real example. [Native-plus-Skills regressions](<../../examples/plugins/package/native_skills_test.go>) verify declared documents are included, captured bytes are not reread, and metadata/content/artifact-path conflicts fail before compilation. Platform tests cover final-open no-follow behavior and after-stat link replacement; the [Unix FIFO regression](<../../examples/plugins/package/static_open_unix_test.go>) checks that a raced FIFO cannot block before the regular-file check.

These tests do not prove host read authorization, Agent admission or UI revocation. Those layers have separate tests under the [Skills contract](<skills-contract.md>). Run Unix-only tests on a Unix runner; cross-compilation alone does not exercise filesystem behavior. No production service, provider call or database connection is required by this example.
