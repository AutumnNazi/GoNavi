#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

resolve_python_bin() {
  local candidate
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -V >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

PYTHON_BIN="$(resolve_python_bin || true)"
if [[ -z "$PYTHON_BIN" ]]; then
  echo "skip: validate-driver-release-manifest.test.sh requires python3 or python" >&2
  exit 0
fi

source_commit="$(git rev-parse HEAD)"
manifest_path="$tmpdir/manifest.json"
cat >"$manifest_path" <<EOF
{
  "schemaVersion": 1,
  "generatedFrom": "$source_commit",
  "assets": {
    "clickhouse-driver-agent-darwin-arm64": {
      "driver": "clickhouse",
      "driverType": "clickhouse",
      "platform": "darwin/arm64",
      "revision": "src-build-runner",
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "size": 1
    },
    "mariadb-driver-agent-linux-amd64": {
      "driver": "mariadb",
      "driverType": "mariadb",
      "platform": "linux/amd64",
      "revision": "src-build-runner",
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "size": 2
    }
  }
}
EOF

bash ./tools/validate-driver-release-manifest.sh --commit HEAD --manifest "$manifest_path"

"$PYTHON_BIN" - "$manifest_path" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
payload = json.loads(path.read_text(encoding="utf-8"))
payload["generatedFrom"] = "0" * 40
path.write_text(json.dumps(payload), encoding="utf-8")
PY

if bash ./tools/validate-driver-release-manifest.sh --commit HEAD --manifest "$manifest_path"; then
  echo "expected manifest source-commit mismatch to fail" >&2
  exit 1
fi

echo "validate-driver-release-manifest test passed"
