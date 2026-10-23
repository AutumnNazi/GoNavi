# Shared plugin marketplace

This service runs independently of the GoNavi desktop. It stores accounts, review history, ratings and sessions in PostgreSQL. It inspects prebuilt packages without executing them. It contains no desktop RPC bridge or plugin process runner.

See the [integration contract](../../docs/plugins/implementation-contract.md) for public DTOs and the [operator API guide](admin-api.md) for publishing and review commands.

## Implemented boundaries

- Public catalog, detail, version and artifact routes expose published versions only. Yanking a version removes it from new requests; it cannot recall copies already downloaded.
- Trusted publisher records determine the official badge. Every catalog sort places official matches first. Rating order uses Bayesian smoothing with weight 10 and the global visible-rating mean (3 when empty); the displayed average remains the arithmetic mean.
- Each account has one mutable rating per plugin. Authors cannot rate their own plugins. Upserts, deletes and moderation run transactionally; hidden ratings stay hidden after edits.
- Publishing reserves a plugin/version, records draft → submitted → validating → pending_review, and waits for a different administrator to approve. Rejection and yank require reasons. Reusing any reserved version is rejected; publish corrections as a new version. A database trigger protects released metadata and bytes.
- GitHub OAuth uses state, S256 PKCE, bounded upstream HTTP calls and explicit device consent. GitHub numeric IDs identify users. The browser login/consent pages use the shared six-language catalogs and negotiate Accept-Language. First signup grants only the user role. Device codes and bearer tokens are hashed in PostgreSQL; access tokens expire after 24 hours and logout revokes them across replicas.
- ZIP/TGZ input is limited to 64 MiB compressed, 256 MiB expanded, 4,096 entries and a 256 KiB manifest. Unsafe paths, links, special files, conflicting names, invalid manifests and missing entrypoints are rejected. At most two submissions validate concurrently per server.

A reviewed package is still trusted third-party code, not proven safe code. Reviewers must inspect source, requested permissions, build provenance and supplied binaries.

## Local setup

Requirements: Go 1.25+, a disposable PostgreSQL 14+ database and an artifact directory writable only by the service account. The service does not create databases or grant roles automatically.

Set these environment variables through your shell or secret manager; never commit their values:

| Variable | Purpose |
| --- | --- |
| GONAVI_MARKET_DATABASE_URL | PostgreSQL connection URL; require verified TLS outside loopback development |
| GONAVI_MARKET_PUBLIC_URL | Public origin, such as https://market.example.org; no path/query/fragment |
| GONAVI_MARKET_LISTEN | Listener, default 127.0.0.1:8090 |
| GONAVI_MARKET_ARTIFACT_ROOT | Private artifact directory, required only for filesystem mode |
| GONAVI_MARKET_ARTIFACT_STORE | filesystem by default; s3 selects the signed object-store adapter |
| GONAVI_MARKET_GITHUB_CLIENT_ID | GitHub OAuth application ID |
| GONAVI_MARKET_GITHUB_CLIENT_SECRET | GitHub OAuth application secret |
| GONAVI_LOG_DIR | Private service log directory |

Only loopback origins may use HTTP. For local development use http://localhost:8090 and register this exact GitHub OAuth callback:

`http://localhost:8090/api/v1/auth/github/callback`

For deployment, use the configured HTTPS origin with the same callback path.

Build once, apply migrations with an operator database credential, then run with a least-privilege runtime database credential:

```sh
go build -o gonavi-market-server ./cmd/gonavi-market-server
./gonavi-market-server -migrate
./gonavi-market-server
```

The server does not apply migrations on startup. Missing tables fail requests rather than creating an in-memory substitute. If both GitHub settings are absent, public reads work but login returns HTTP 503 with code auth_unavailable. Partial OAuth configuration prevents startup.

## Containers

The [Dockerfile](Dockerfile) builds only the server and its required local packages. The [Compose file](compose.yaml) is for disposable local development, not a production deployment template. It binds ports to loopback, runs the service as an unprivileged user, drops capabilities and provides a bounded, no-execute temporary filesystem.

Supply MARKET_POSTGRES_PASSWORD and GONAVI_MARKET_DATABASE_URL externally. The latter must point to the Compose postgres service on port 5432 and database gonavi_market_test, using an appropriately URL-encoded password. Then, from the repository root:

```sh
docker compose -f deploy/plugin-market/compose.yaml up -d postgres
docker compose -f deploy/plugin-market/compose.yaml run --rm market -migrate
docker compose -f deploy/plugin-market/compose.yaml up -d market
```

No container, migration or deployment is started merely by adding these files.

## S3-compatible storage

Set GONAVI_MARKET_ARTIFACT_STORE=s3 and provide GONAVI_MARKET_S3_ENDPOINT (regional HTTPS service URL, without the bucket), GONAVI_MARKET_S3_REGION, GONAVI_MARKET_S3_BUCKET, GONAVI_MARKET_S3_ACCESS_KEY_ID and GONAVI_MARKET_S3_SECRET_ACCESS_KEY. Optional settings are GONAVI_MARKET_S3_PREFIX and GONAVI_MARKET_S3_SESSION_TOKEN. Local test endpoints may explicitly set GONAVI_MARKET_S3_ALLOW_HTTP=true; never use that override for production credentials.

The adapter performs real path-style AWS SigV4 PUT/GET requests, sends If-None-Match: * on publication and verifies full bytes after writes and before reads. Redirects are rejected. Existing keys succeed only if their exact size and SHA-256 match. The bucket must implement atomic conditional writes; configure a private bucket with least-privilege GetObject/PutObject permissions and deny independent overwrite/delete access. The service does not expose object-store URLs to clients.

This is a bounded single-object adapter, not a full S3 SDK: automatic credential discovery/refresh, multipart uploads, retries, bucket-policy provisioning, Object Lock configuration and directory buckets are not implemented. Rotate configured credentials externally. S3 compatibility is tested against HTTP fixtures; verify signatures, conditional writes and private-bucket policy against your chosen provider in staging.

## Operating safely

1. Terminate HTTPS at a reverse proxy. Set a 65 MiB request limit and a two-minute upstream timeout. Disable access-log query strings for OAuth callback routes; never log authorization headers or cookies.
2. Keep the artifact directory private. Only the service byte route checks publication state; do not expose the directory as static files. Keep released objects immutable and back up artifacts with the database.
3. Separate operator and runtime database credentials. Runtime needs normal data mutations and USAGE on the audit/report ID sequences, but no schema changes, role grants or audit updates/deletes. Grant only id/login inserts and login updates on market_users; operator bootstrap alone changes role, publisher_id and official. Store credentials in a secret manager. Disable database bind-parameter logging for authentication queries; OAuth PKCE state is short-lived but still sensitive.
4. Put distributed rate limits and upload quotas at the proxy. The built-in limit is 120 mutating/auth requests per minute per direct peer and a bounded 8,192-peer map. It deliberately ignores forwarded-IP headers; behind a proxy, peer-based limits are shared. Sixty-four requests and at most two combined artifact operations (validation/upload/download) run concurrently per instance. S3 verifies in-memory snapshots; the container uses a 384 MiB Go memory target inside its 512 MiB limit. Size memory and proxy quotas for your workload.
5. Deploy replicas only with shared PostgreSQL and shared artifact storage. OAuth flows, device decisions and token consumption are transactional across replicas. Local filesystem storage requires a shared volume with atomic link/create semantics.
6. Keep rejected and yanked versions for audit. Unreferenced stored artifacts can remain after a database failure. No automatic artifact garbage collector is supplied. Review orphan candidates before deleting them.
7. A crash or cancellation during validation can leave a reserved version in draft/submitted/validating. Treat these as incomplete, never public. The initial implementation has no automatic job retry or stale-upload recovery command; preserve the audit record and submit a new version.

Each version contains one immutable archive; multi-platform packages bundle their declared platform entrypoints. Separate replacement archives under the same version are not supported.

The catalog uses bounded offset cursors (maximum offset 10,000), returns at most 100 entries and chooses the newest compatible published version. Concurrent publications can move page boundaries. Ratings and version lists return the newest 100 entries; review/audit lists return at most 200. A full marketplace website, token refresh, organization/team publishers, signing/provenance verification, malware scanning, arbitrary search facets and background cleanup workers are not shipped.

## Verification

```sh
go test ./internal/market ./cmd/gonavi-market-server
go vet ./internal/market ./cmd/gonavi-market-server
# Requires a supported C toolchain for Go's race detector:
go test -race ./internal/market
```

HTTP tests use an explicitly injected fake repository/identity provider, temporary immutable artifacts and httptest. GitHub adapter tests use bounded mock HTTP servers; they do not contact GitHub.

Real PostgreSQL tests are opt-in. Set GONAVI_MARKET_TEST_POSTGRES to a disposable loopback database URL whose database name ends in _test, then run:

```sh
go test ./internal/market -run TestPostgres -count=1 -v
```

Those tests create a random schema, run real migrations, exercise SQL transactions/constraints and remove only that schema. They parse pq's effective configuration (including hostaddr and environment overrides), reject remote/multiple targets and other database names, then freeze the validated connector to a loopback address before connecting. If the variable is absent, they report a skip; fake-repository tests are not evidence that PostgreSQL migrations executed. Live GitHub authorization, deployment TLS/proxy behavior and production object storage require separate staging verification.
