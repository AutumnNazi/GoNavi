#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

extract_revision() {
  local file="$1"
  local driver="$2"
  sed -n "s/.*\"${driver}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$file" | head -n 1
}

copy_repo_to_tmp() {
  local target="$1"
  git ls-files -z | tar --null -T - -cf - | (cd "$target" && tar -xf -)
}

tmpdir_failure="$(mktemp -d "${TMPDIR:-/tmp}/gonavi-generate-driver-revisions-failure.XXXXXX")"
tmpdir_platform="$(mktemp -d "${TMPDIR:-/tmp}/gonavi-generate-driver-revisions-platform.XXXXXX")"
tmpdir_connection="$(mktemp -d "${TMPDIR:-/tmp}/gonavi-generate-driver-revisions-connection.XXXXXX")"
darwin_file="$(mktemp "${TMPDIR:-/tmp}/gonavi-darwin-revisions.XXXXXX")"
windows_file="$(mktemp "${TMPDIR:-/tmp}/gonavi-windows-revisions.XXXXXX")"
cleanup() {
  rm -rf "$tmpdir_failure" "$tmpdir_platform" "$tmpdir_connection"
  rm -f "$darwin_file" "$windows_file"
}
trap cleanup EXIT

copy_repo_to_tmp "$tmpdir_failure"

(
  cd "$tmpdir_failure"
  cp internal/db/driver_agent_revisions_gen.go driver_agent_revisions.before.go
  mkdir -p fake-bin
  cat >fake-bin/go <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "list" ]]; then
  printf '%s\n' "$PWD/cmd/optional-driver-agent/main.go"
  exit 42
fi

exec "${REAL_GO:?}" "$@"
EOF
  chmod +x fake-bin/go

  if REAL_GO="$(command -v go)" PATH="$PWD/fake-bin:$PATH" GONAVI_DRIVER_REVISION_JOBS=1 \
    bash ./tools/generate-driver-agent-revisions.sh --platform darwin/arm64 --drivers mariadb \
      >generator.stdout 2>generator.stderr; then
    echo "expected revision generation to fail when go list returns a partial result" >&2
    exit 1
  fi
  if ! cmp -s driver_agent_revisions.before.go internal/db/driver_agent_revisions_gen.go; then
    echo "expected failed revision generation to preserve the existing revision file" >&2
    exit 1
  fi
  if ! grep -Fq "driver-agent dependency enumeration failed: mariadb (darwin/arm64)" generator.stderr; then
    echo "expected failed revision generation to report the dependency enumeration error" >&2
    cat generator.stderr >&2
    exit 1
  fi
)

copy_repo_to_tmp "$tmpdir_platform"

(
  cd "$tmpdir_platform"
  GONAVI_DRIVER_REVISION_JOBS=1 bash ./tools/generate-driver-agent-revisions.sh --platform darwin/arm64 --drivers duckdb >/dev/null
  cp internal/db/driver_agent_revisions_gen.go "$darwin_file"
  GONAVI_DRIVER_REVISION_JOBS=1 bash ./tools/generate-driver-agent-revisions.sh --platform windows/amd64 --drivers duckdb >/dev/null
  cp internal/db/driver_agent_revisions_gen.go "$windows_file"
)

darwin_duckdb="$(extract_revision "$darwin_file" duckdb)"
windows_duckdb="$(extract_revision "$windows_file" duckdb)"
if [[ -z "$darwin_duckdb" || -z "$windows_duckdb" ]]; then
  echo "expected duckdb revision to be generated for both platforms" >&2
  exit 1
fi
if [[ "$darwin_duckdb" == "$windows_duckdb" ]]; then
  echo "expected duckdb revision to differ between darwin/arm64 and windows/amd64, got identical value: $darwin_duckdb" >&2
  exit 1
fi

copy_repo_to_tmp "$tmpdir_connection"

(
  cd "$tmpdir_connection"
  GONAVI_DRIVER_REVISION_JOBS=1 bash ./tools/generate-driver-agent-revisions.sh --platform windows/amd64 --drivers sqlserver >/dev/null
  before_file="$(mktemp "${TMPDIR:-/tmp}/gonavi-sqlserver-revision-before.XXXXXX")"
  after_file="$(mktemp "${TMPDIR:-/tmp}/gonavi-sqlserver-revision-after.XXXXXX")"
  cleanup_sqlserver_revision_files() {
    rm -f "$before_file" "$after_file"
  }
  trap cleanup_sqlserver_revision_files EXIT

  cp internal/db/driver_agent_revisions_gen.go "$before_file"
  perl -0pi -e 's/RedisSentinelMaster   string/RedisSentinelLabel    string           `json:"redisSentinelLabel,omitempty"`\n\tRedisSentinelMaster   string/' internal/connection/types.go
  GONAVI_DRIVER_REVISION_JOBS=1 bash ./tools/generate-driver-agent-revisions.sh --platform windows/amd64 --drivers sqlserver >/dev/null
  cp internal/db/driver_agent_revisions_gen.go "$after_file"

  before_sqlserver="$(extract_revision "$before_file" sqlserver)"
  after_sqlserver="$(extract_revision "$after_file" sqlserver)"
  if [[ -z "$before_sqlserver" || -z "$after_sqlserver" ]]; then
    echo "expected sqlserver revision to be generated before and after connection-only change" >&2
    exit 1
  fi
  if [[ "$before_sqlserver" != "$after_sqlserver" ]]; then
    echo "expected Redis-only connection field change to keep sqlserver revision stable, before=$before_sqlserver after=$after_sqlserver" >&2
    exit 1
  fi
)

echo "generate-driver-agent-revisions platform test passed"
