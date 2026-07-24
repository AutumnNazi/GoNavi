#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

usage() {
  cat <<'EOF'
用法：
  ./tools/validate-driver-release-manifest.sh --commit <ref> --manifest <path>

说明：
  校验已发布 driver release manifest 是否与指定源码提交绑定，
  且每个资产均包含完整的 SHA 绑定 provenance 元数据。
EOF
}

source_commit=""
manifest_path=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit)
      source_commit="${2:-}"
      shift 2
      ;;
    --manifest)
      manifest_path="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$source_commit" || -z "$manifest_path" ]]; then
  usage >&2
  exit 1
fi

if [[ ! -f "$manifest_path" ]]; then
  echo "manifest 不存在：$manifest_path" >&2
  exit 1
fi

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
  echo "未找到 Python，请先安装 python3 或 python 并确保其在 PATH 中。" >&2
  exit 1
fi

if ! git rev-parse --verify "${source_commit}^{commit}" >/dev/null 2>&1; then
  echo "无法解析源码提交：$source_commit" >&2
  exit 1
fi
source_commit="$(git rev-parse "${source_commit}^{commit}")"

"$PYTHON_BIN" - "$manifest_path" "$source_commit" <<'PY'
import json
import re
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1]).resolve()
source_commit = sys.argv[2]

with manifest_path.open("r", encoding="utf-8") as fh:
    manifest = json.load(fh)

assets = manifest.get("assets") or {}

errors = []
if manifest.get("schemaVersion") != 1:
    errors.append(f"schemaVersion={manifest.get('schemaVersion')!r}，期望 1")
if str(manifest.get("generatedFrom") or "").strip() != source_commit:
    errors.append(
        f"generatedFrom={manifest.get('generatedFrom')!r}，期望源码提交 {source_commit}"
    )
if not isinstance(assets, dict) or not assets:
    errors.append("assets 为空或格式无效")
else:
    for asset_name, meta in sorted(assets.items()):
        if not isinstance(meta, dict):
            errors.append(f"{asset_name}: 元数据格式无效")
            continue
        driver = str(meta.get("driver") or meta.get("driverType") or "").strip()
        platform = str(meta.get("platform") or "").strip()
        revision = str(meta.get("revision") or "").strip()
        sha256 = str(meta.get("sha256") or "").strip().lower()
        size = meta.get("size")
        if not driver:
            errors.append(f"{asset_name}: 缺少 driver")
        if not re.fullmatch(r"[^/\\]+/[^/\\]+", platform):
            errors.append(f"{asset_name}: platform 无效: {platform!r}")
        if not revision.startswith("src-"):
            errors.append(f"{asset_name}: revision 无效: {revision!r}")
        if not re.fullmatch(r"[0-9a-f]{64}", sha256):
            errors.append(f"{asset_name}: sha256 无效")
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
            errors.append(f"{asset_name}: size 无效: {size!r}")

if errors:
    print("published driver release manifest 元数据无效：", file=sys.stderr)
    for error in errors:
        print(f"  - {error}", file=sys.stderr)
    raise SystemExit(1)

print(f"manifest validation passed: {len(assets)} assets")
PY
