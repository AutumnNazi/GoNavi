# Packaged plugin Skills: first vertical slice

This slice adds immutable packaged skill documents to the existing plugin lifecycle and Agent tool catalog. It does not replace user-authored AIGetSkills/AISaveSkill settings, execute scripts, grant tools, or silently append plugin text to system prompts. Previously delivered model text cannot be retroactively unread; revocation applies to subsequent discovery/load/resolve, not erasure of conversation history.

## Declaration

Explicit permission `ai.skills`; `contributes.skills` at most 16 entries `{id,name,description,entry}`. ID matches lowercase `^[a-z][a-z0-9_.-]{0,63}$` and is unique within skills. Name is nonblank/bounded256 UTF-8 bytes; description nonblank/bounded2048; no NUL. Entry is a canonical portable package-relative path ending in exact `SKILL.md` (no absolute/drive/UNC/backslash/dot/dotdot/ambiguous components). Existing safe package path checks remain authoritative. Backend is optional. Required tools, hooks, external resource loading and YAML authority interpretation are not part of v1.

Content must be regular non-symlink/reparse UTF-8 text, nonempty, no NUL, <=64KiB. Local package inspection/installation and market submission must validate that declared entries exist and meet limits without executing anything. Metadata in manifest is authoritative; markdown/frontmatter stays opaque text. Only declared paths may be read, not arbitrary caller paths or URLs. Body/credentials are never logged.

## Runtime API

Public declaration `plugin.Skill` and `Contributions.Skills []Skill` plus matching public Go/TS SDK DTOs. Public content `SkillContent{pluginId,skillId,name,description,version,digest,generation,content}`. API `Manager.ReadSkillGeneration(ctx,id,generation,skillID,digest)(SkillContent,error)`.

Requires existing locally owned live runtime, desired-enabled StateRunning, nonzero expected generation, exact current package digest, explicit ai.skills and actual declared skill. Catalog/read never Start or enable a plugin. File-only packages work through existing contribution-only lifecycle without creating native children. Reader validates package integrity and path/handle safety before bounded read, rejects symlink/reparse/path races, checks generation/digest/admission again after read, and respects context. Missing/stale/disabled/safe-mode/other-owner must fail, with no fallback or replay. Do not weaken current archive/path guards.

## Host and Agent

`App.PluginSkills() connection.QueryResult` returns `{items:[{pluginId,id,name,description,entry,version,digest,generation,available,reason?}]}` with no body. Installed disabled entries may be displayed unavailable; discovery never activates code.

`App.PluginSkillRead(pluginID,skillID,digest string,generation uint64) connection.QueryResult` calls the bounded runtime reader; Web stays fail-closed under existing plugin policy until explicitly authenticated management is implemented. Use context-aware Web routing for request cancellation. Keep bindings thin and localized; no raw paths/errors/body in logs.

The hosted built-in 3B provider keeps its deliberately curated SQL-only tool policy and does NOT offer plugin Skills in v1. Custom tool-capable Agent providers can use the new loaders; explicit UI preview remains independent. Do not widen that whitelist or re-enable external CLI bundled/global skills. Surface this compatibility limit in UI/docs/tests.

A separate `PluginSkillCatalog` implements existing runharness.ToolCatalog and is composed into BOTH desktop and CLI Agent catalogs through a skills-only augmentation wrapper. Ordinary tools are listed once and never removed. Append at most 32 eligible skills in deterministic order, only within 128 combined descriptors and 256KiB serialized metadata; an already-over-budget ordinary catalog receives no skills. Direct skill Resolve must obey current membership too. Skill-only failures degrade without breaking ordinary tools, except request cancellation. UI/docs state these caps and distinguish installed/runtime availability from provider/catalog selection. One skill => provider-safe hashed alias `skill__<base32sha256(pluginID NUL skillID)>`, empty strict object input, read-only effect, bounded default timeout/result. List only metadata; Resolve and Execute revalidate exact snapshot; capabilities pin plugin/skill/digest/generation. Add NewAppPluginSkillCatalog and NewPluginSkillCatalogForBackend wrappers matching existing integration accessors. Listing must never activate or read skill bodies; explicit tool use reads the declared document as a tool-result resource, NOT a privileged system instruction or automatic tool grant. Frozen descriptors and old executors must fail after disable/re-enable/update/remove. Ordinary command/driver behavior stays unchanged.

Do not merge package skills into Service.AIGetSkills or persist body copies as user settings. Preserve existing user skill storage and automatic user-authored scope semantics. Agent skill descriptions may advertise intended use; no body injection or provider call occurs during discovery. Historical model messages cannot be revoked; document this limit explicitly.

## UI and SDK

A separate read-only packaged Skills section in AI settings and/or plugin details lists provenance, identity/status, and explicit preview. Load only when requested, bind request to digest/generation and fence late responses; revoke visible loaded content when plugin disabled/removed or snapshot changes. Render text safely (no HTML/scripts/remote URL fetch). Keep existing user-authored skill editor untouched in behavior; no editing/copying into auto-system prompts. Use existing app/plugin change events and bounded discovery; all strings in six locales, no giant root component growth.

Public SDK declaration types plus a static, backend-free example package with a useful read-only database investigation SKILL.md; it must not pretend to execute SQL or own database permissions. Packing/examples/docs explain install/enable, explicit Agent loading, limits and untrusted-text authority. No new dependencies needed.

## Ownership

Runtime declaration/secure read/package inspection/public SDK DTOs: plugin-runtime.
Host+Agent integration: plugin-sdk.
Frontend packaged skill listing/preview: plugin-ui.
Marketplace declaration+artifact validation: market-service.
Static example/packager compatibility and public guide: market-client.
Lead: contracts, generated bindings/catalogs, integration review and final tests. Independent review will follow stable APIs.
