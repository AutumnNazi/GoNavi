#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/gonavi-driver-revision-contract.XXXXXX")"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

revision_file="$tmpdir/driver_agent_revisions_gen.go"
printf '%s\n' '// generated revision fixture' > "$revision_file"

platforms=(
  darwin/amd64
  darwin/arm64
  linux/amd64
  linux/arm64
  windows/amd64
  windows/arm64
)

for platform in "${platforms[@]}"; do
  bash ./tools/write-driver-revision-contract.sh \
    --role gui \
    --platform "$platform" \
    --output-dir "$tmpdir/contracts" \
    --revision-file "$revision_file"
  bash ./tools/write-driver-revision-contract.sh \
    --role cli \
    --platform "$platform" \
    --output-dir "$tmpdir/contracts" \
    --revision-file "$revision_file"
done

bash ./tools/verify-driver-revision-contract.sh --contracts-dir "$tmpdir/contracts" >/dev/null

printf '%s\n' '// changed GUI revision fixture' > "$revision_file"
bash ./tools/write-driver-revision-contract.sh \
  --role gui \
  --platform darwin/arm64 \
  --output-dir "$tmpdir/contracts" \
  --revision-file "$revision_file"
if bash ./tools/verify-driver-revision-contract.sh --contracts-dir "$tmpdir/contracts" >"$tmpdir/mismatch.stdout" 2>"$tmpdir/mismatch.stderr"; then
  echo "expected a mismatched GUI/CLI contract to fail" >&2
  exit 1
fi
grep -Fq 'driver revision contract mismatch for darwin-arm64' "$tmpdir/mismatch.stderr"

printf '%s\n' '// generated revision fixture' > "$revision_file"
bash ./tools/write-driver-revision-contract.sh \
  --role gui \
  --platform darwin/arm64 \
  --output-dir "$tmpdir/contracts" \
  --revision-file "$revision_file"

rm -f "$tmpdir/contracts/cli-linux-arm64.sha256"
if bash ./tools/verify-driver-revision-contract.sh --contracts-dir "$tmpdir/contracts" >"$tmpdir/missing.stdout" 2>"$tmpdir/missing.stderr"; then
  echo "expected a missing GUI/CLI contract to fail" >&2
  exit 1
fi
grep -Fq 'missing driver revision contract' "$tmpdir/missing.stderr"

for workflow in .github/workflows/release.yml .github/workflows/dev-build.yml; do
  grep -Fq 'tools/write-driver-revision-contract.sh --role cli' "$workflow"
  grep -Fq 'tools/write-driver-revision-contract.sh --role gui' "$workflow"
  grep -Fq 'tools/verify-driver-revision-contract.sh --contracts-dir driver-revision-contract' "$workflow"
done

echo "driver revision contract test passed"
