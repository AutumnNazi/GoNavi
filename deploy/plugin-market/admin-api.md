# Publisher and administrator API

All API paths below are relative to the configured service origin plus /api/v1. Successful responses are JSON except the browser consent pages and artifact bytes. Errors use {"code":"...","message":"..."}; message currently carries the stable machine code for client localization. No response contains database errors, OAuth secrets or connection strings.

## Explicit account bootstrap

Use an operator database credential. Resolve the intended account's immutable numeric GitHub ID independently; a rename must not change its privileges. Run one explicit grant for each publisher or administrator:

```sh
./gonavi-market-server -grant-github-id GITHUB_NUMERIC_ID -grant-role admin
./gonavi-market-server -grant-github-id PUBLISHER_NUMERIC_ID -grant-role publisher -publisher example
# Only verified, operator-approved publishers receive an official badge:
./gonavi-market-server -grant-github-id VERIFIED_NUMERIC_ID -grant-role publisher -publisher verified -official
```

The command records an audit event and exits. It can reserve an identity before its first login. It does not create a bearer token. Publishers own one lowercase namespace and may submit only IDs under that namespace (for example example.viewer). Once a publisher owns a plugin, the namespace cannot be silently reassigned. To revoke publisher/admin privileges, explicitly grant role user while preserving any existing publisher namespace (and omit -official). Existing sessions reload current privileges on every request, so the account loses privileged actions immediately while ownership and the author self-rating guard remain intact.

There is no first-user administrator rule, public role-grant endpoint or default administrator password.

## Obtain a real token

1. POST /auth/device. Copy deviceCode privately; display userCode and open verificationUri.
2. Enter that user code on the same-origin page. Complete GitHub authorization and explicitly approve the code shown by your own GoNavi installation.
3. Poll POST /auth/device/token with {"deviceCode":"..."} no faster than intervalSeconds. Pending, denied and expired never include a token. Authorized includes accessToken and expiresIn.
4. Send Authorization: Bearer ACCESS_TOKEN on authenticated API requests. GET /auth/session shows the current account. POST /auth/logout revokes the current session.

Device grants expire after ten minutes; access tokens expire after 24 hours. Early polls return HTTP 429 / slow_down with Retry-After: 5. Authorization is consumed once; replay returns expired. Refresh tokens and a browser account dashboard are not implemented. Tokens must not appear in URLs, shell history, logs or committed scripts. The curl examples below assume a short-lived local environment variable named TOKEN; production automation should inject it securely.

## Submit a prebuilt package

The multipart request contains exactly three parts: pluginId, version and package. The ZIP/TGZ root must contain gonavi.plugin.json. Form metadata must match the validated manifest. The manifest cannot assign service privileges or an official badge.

```sh
curl --fail-with-body -H "Authorization: Bearer $TOKEN"   -F 'pluginId=example.viewer' -F 'version=1.0.0' -F 'package=@viewer.zip'   "$BASE/api/v1/submissions"
curl --fail-with-body -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/submissions"
```

A valid upload returns HTTP 201 with state pending_review and the archive's SHA-256. Validation failure returns artifact_invalid and retains a rejected reservation/audit record. A transient store/database failure is not a successful submission. Reserved plugin/version identities cannot be overwritten, including rejected versions; bump the version for changes.

Uploads are never executed. Validation checks structure, resource bounds, manifest shape and entry references, not whether a binary is benign or correctly implements the runtime protocol.

## Review, reject and yank

Administrators list the review queue, then inspect GET /admin/submissions/{id}. That private response contains the exact validated manifest and an administrator-only artifact URL at /admin/submissions/{id}/artifact. Fetch that URL with an administrator bearer token; it remains unavailable through the public artifact route until approval. Private inspection does not increase download counts. A publisher token cannot review. An administrator cannot approve their own package.

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
- PUT /plugins/{id}/rating accepts {"stars":1..5,"body":"text","version":"1.0.0"}. Omit version to rate the newest published version. Body is limited to 4,000 UTF-8 bytes. The service derives userId from the bearer token and forbids author self-rating.
- DELETE /plugins/{id}/rating deletes only the caller's rating.
- POST /reports accepts {"pluginId":"example.viewer","reason":"..."}; reports are stored for operator triage. A report dashboard/list API is not yet supplied.
- POST /admin/plugins/{id}/ratings/{userId}/hide accepts {"reason":"..."}. This administrator-only operation hides the rating and records an audit event atomically.

A hidden rating stays hidden when its author edits it or deletes and recreates it. Deletion clears the review body/version and leaves a non-public tombstone to preserve moderation. Visible aggregates are computed from the authoritative rating table rather than denormalized counters that can drift.

## Public download contract

GET /plugins/{id}/versions returns published MarketPlugin objects with exact manifests. GET /plugins/{id}/versions/{version}/artifact?platform=linux/amd64 returns {url,sha256,sizeBytes,platform,version}. The same-origin URL identifies exact archive bytes; it is not a signed external URL. The byte response uses application/zip or application/gzip and a matching attachment suffix. Clients should also check ZIP/gzip magic and verify size and transport SHA-256 before inspecting the package.

Transport SHA-256 differs from the runtime's canonical installed-content digest. After transport verification, call the runtime inspector and pass its returned digest to installation. Do not recompress artifacts or substitute another version after the user approves a preview. The publication gate applies even when the caller already knows a yanked digest.

Download counts measure accepted byte-download requests, not completed transfers or installations. HEAD requests do not increase them. Downloads are unauthenticated and never need a bearer token.
