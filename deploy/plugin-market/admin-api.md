# Publisher and administrator API

All API paths below are relative to the configured service origin plus /api/v1. Successful responses are JSON except OAuth redirects and artifact bytes. Errors use {"code":"...","message":"..."}; message currently carries the stable machine code for client localization. No response contains database errors, OAuth secrets or connection strings.

## Account bootstrap

A first login self-serves a publisher role and a `gh-<github-login>` namespace, so authors can publish immediately after signing in; GitHub logins are unique case-insensitively, so the derived namespace never collides. Operators still own privileged and verified grants with an operator database credential. Resolve the intended account's immutable numeric GitHub ID independently; a rename must not change its privileges:

```sh
./gonavi-market-server -grant-github-id GITHUB_NUMERIC_ID -grant-role admin
./gonavi-market-server -grant-github-id PUBLISHER_NUMERIC_ID -grant-role publisher -publisher example
# Only verified, operator-approved publishers receive an official badge:
./gonavi-market-server -grant-github-id VERIFIED_NUMERIC_ID -grant-role publisher -publisher verified -official
```

The command records an audit event and exits. It can reserve an identity before its first login. A role grant does not create a token; issue an operator session separately when automation needs one. Publishers own one namespace and may submit only IDs under that namespace (for example example.viewer). Once a publisher owns a plugin, the namespace cannot be silently reassigned. To revoke publisher/admin privileges, explicitly grant role user while preserving any existing publisher namespace (and omit -official). Existing sessions reload current privileges on every request, so the account loses privileged actions immediately while ownership and the author self-rating guard remain intact.

There is no first-user administrator rule, public role-grant endpoint or default administrator password.

## Sessions

The website is the only interactive account and write entry. A human signs in through GitHub:

1. GET /auth/web/start?returnTo=/publish sets short-lived HttpOnly state and returnTo cookies, records a single-use S256 PKCE oauth flow and redirects to GitHub.
2. GitHub redirects to the one registered callback, GET /auth/github/callback. The server consumes the oauth flow, upserts the GitHub identity, stores a session hash and sets an HttpOnly SameSite=Lax session cookie (24 hours; __Host- prefixed on HTTPS) before redirecting to returnTo.
3. GET /auth/web/session returns {"authenticated":false} for anonymous callers, otherwise the account plus the CSRF token. Cookie-authenticated POST/PUT/DELETE requests must send X-GoNavi-CSRF with that value.
4. POST /auth/web/logout requires the same CSRF header, revokes the cookie session and clears the cookie.

Operators and automation use an explicit bearer token instead of a browser. Run this with the operator database credential and the usual service environment:

```sh
./gonavi-market-server -issue-session GITHUB_NUMERIC_ID
./gonavi-market-server -issue-session GITHUB_NUMERIC_ID -session-ttl 168h
```

The command resolves the existing account (grant its role first), stores only the SHA-256 hash in market_sessions and prints the 43-character token once to stdout. The default lifetime is 720h; accepted values are 1h to 8760h. It never prints or logs the database URL. Treat the printed value as a secret: it cannot be recovered, only revoked.

- GET /auth/session with Authorization: Bearer TOKEN returns the current account and re-reads stored privileges on every request.
- POST /auth/logout revokes the presented bearer session and returns {"revoked":true}; later calls return 401.
- Role changes take effect immediately because sessions carry no cached privileges.

The desktop client is an anonymous read-only consumer: it lists the catalog, downloads artifacts and reads ratings, but does not log in, publish or write ratings. There are no device codes, consent pages, refresh tokens or client-submitted write endpoints.

## Submit a prebuilt package

The multipart request contains three required parts: pluginId, version and package. The optional source part registers a canonical public GitHub repository URL such as https://github.com/owner/repo for future Release updates. The optional expectedDigest part pins the SHA-256 returned by a pre-flight inspection; when it no longer matches the uploaded bytes the request fails with 409 inspection_changed before any version is reserved. The ZIP/TGZ root must contain gonavi.plugin.json. Form metadata must match the validated manifest. The manifest cannot assign service privileges or an official badge.

```sh
curl --fail-with-body -H "Authorization: Bearer $TOKEN"   -F 'pluginId=example.viewer' -F 'version=1.0.0' -F 'package=@viewer.zip'   "$BASE/api/v1/submissions"
curl --fail-with-body -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/submissions"
```

A valid upload returns HTTP 201 with state published and the archive's SHA-256: publication is self-service once static validation passes, with the full audit trail retained. Validation failure returns artifact_invalid and retains a rejected reservation/audit record. A transient store/database failure is not a successful submission. Reserved plugin/version identities cannot be overwritten, including rejected and published versions; bump the version for changes.

Uploads are never executed. Validation checks structure, resource bounds, manifest shape and entry references, not whether a binary is benign or correctly implements the runtime protocol. Oversight happens after publication: official badges are operator-granted only, and administrators can yank a published version at any time.

## Automatic GitHub Release updates

Register the repository once when publishing the first package, either in the website's optional source repository field or with multipart source:

```sh
curl --fail-with-body -H "Authorization: Bearer $TOKEN" \
  -F 'pluginId=example.viewer' -F 'version=1.0.0' \
  -F 'source=https://github.com/owner/repo' -F 'package=@viewer.zip' \
  "$BASE/api/v1/submissions"
```

After registration, authors only need to publish a newer stable GitHub Release containing exactly one ZIP, TGZ or TAR.GZ plugin archive. Pushing code or a tag without publishing a Release asset is not enough. The archive manifest must retain the registered plugin ID and increase its semantic version; the manifest version, not the tag text, determines whether an update is newer. Drafts and prereleases are not selected. The fetcher currently follows the repository-wide latest Release, without tag-prefix filtering; shared official repositories retain their existing explicitly tagged installation channel.

The server downloads the archive, runs the same static validation and ownership checks as an upload, and rehosts immutable bytes under its own artifact origin. Same or older versions and foreign plugin manifests never replace the published package. Failed lookups or validation leave the previous version available and are retried on the next pass; reserved versions remain immutable, so a rejected package must use a new version. Manual upload remains available. No plugin code is executed.

The worker starts one minute after service startup and repeats six hours after each completed pass. Set GONAVI_MARKET_SYNC_INTERVAL to an integer number of seconds (minimum 60) to override the interval. Invalid values use the six-hour default. An optional GONAVI_MARKET_GITHUB_TOKEN raises the GitHub API quota; inject it through the service environment, never into source control or logs. Without it, the anonymous quota is shared across tracked repositories and API users of the server address. Each background pass is limited to ten minutes, inherits shutdown cancellation, and is joined before the service closes its database.

Operators can run one pass immediately using the existing service environment and database credential:

```sh
./gonavi-market-server -sync-once
# Or, with an administrator bearer token:
curl --fail-with-body -X POST -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/v1/admin/sync"
```

Both return per-plugin outcomes (pluginId, version, skipped, published and reason). Inspect those outcomes even when the process exits successfully: one plugin's failure does not abort other plugins. Public catalog responses expose sourceUrl; the website and clients see a newly published version through the same live catalog, and installed clients compare it with their local version.

## Supervision and yank

Administrators list submissions, then inspect GET /admin/submissions/{id}. That private response contains the exact validated manifest and an administrator-only artifact URL at /admin/submissions/{id}/artifact. Fetch that URL with an administrator bearer token. Private inspection does not increase download counts. A publisher token cannot review. An administrator cannot approve their own package.

```sh
curl --fail-with-body -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/admin/submissions"
curl --fail-with-body -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json'   -d '{"reason":"source and permissions reviewed"}' "$BASE/api/v1/admin/submissions/SUBMISSION_ID/approve"
curl --fail-with-body -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json'   -d '{"reason":"permission justification missing"}' "$BASE/api/v1/admin/submissions/SUBMISSION_ID/reject"
curl --fail-with-body -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json'   -d '{"reason":"confirmed security issue"}' "$BASE/api/v1/admin/submissions/SUBMISSION_ID/yank"
curl --fail-with-body -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/admin/audit"
```

Approval/rejection requires pending_review; yank requires published. Repeated or invalid transitions return HTTP 409. Reject/yank require a nonempty reason. Review state changes and audit inserts commit together. A rejected or yanked new version does not hide an older published version. There is no restore/un-yank route in this version.

## Ratings and reports

- GET /plugins/{id}/ratings lists visible ratings.
- PUT /plugins/{id}/rating accepts {"stars":1..5,"body":"text","version":"1.0.0"}. Omit version to rate the newest published version. Body is limited to 4,000 UTF-8 bytes. The service derives userId from the authenticated session (website cookie or operator bearer token) and forbids author self-rating.
- DELETE /plugins/{id}/rating deletes only the caller's rating.
- POST /reports accepts {"pluginId":"example.viewer","reason":"..."}; reports are stored for operator triage. A report dashboard/list API is not yet supplied.
- POST /admin/plugins/{id}/ratings/{userId}/hide accepts {"reason":"..."}. This administrator-only operation hides the rating and records an audit event atomically.

A hidden rating stays hidden when its author edits it or deletes and recreates it. Deletion clears the review body/version and leaves a non-public tombstone to preserve moderation. Visible aggregates are computed from the authoritative rating table rather than denormalized counters that can drift.

## Public download contract

GET /plugins/{id}/versions returns published MarketPlugin objects with exact manifests. GET /plugins/{id}/versions/{version}/artifact?platform=linux/amd64 returns {url,sha256,sizeBytes,platform,version}. The same-origin URL identifies exact archive bytes; it is not a signed external URL. The byte response uses application/zip or application/gzip and a matching attachment suffix. Clients should also check ZIP/gzip magic and verify size and transport SHA-256 before inspecting the package.

Transport SHA-256 differs from the runtime's canonical installed-content digest. After transport verification, call the runtime inspector and pass its returned digest to installation. Do not recompress artifacts or substitute another version after the user approves a preview. The publication gate applies even when the caller already knows a yanked digest.

Download counts measure accepted byte-download requests, not completed transfers or installations. HEAD requests do not increase them. Downloads are unauthenticated and never need a bearer token.
