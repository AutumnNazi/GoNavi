#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/compress-driver-artifact.sh <file> <GOOS/GOARCH> [label]

Environment:
  GONAVI_DRIVER_AGENT_UPX=auto|on|off|required

The default mode is auto: compress supported driver artifacts when upx is
available, and skip cleanly otherwise.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

artifact_path="${1:-}"
platform="${2:-}"
label="${3:-$artifact_path}"
mode="$(printf '%s' "${GONAVI_DRIVER_AGENT_UPX:-auto}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"

if [[ -z "$artifact_path" || -z "$platform" ]]; then
  usage >&2
  exit 2
fi

if [[ ! -f "$artifact_path" ]]; then
  echo "⚠️  UPX 跳过：文件不存在：$artifact_path"
  exit 0
fi

case "$mode" in
  ""|auto)
    mode="auto"
    ;;
  1|true|yes|on|enabled)
    mode="on"
    ;;
  required|strict)
    mode="required"
    ;;
  0|false|no|off|disabled)
    echo "ℹ️  UPX 已关闭：$label"
    exit 0
    ;;
  *)
    echo "❌ GONAVI_DRIVER_AGENT_UPX 参数无效：$mode" >&2
    exit 2
    ;;
esac

goos="${platform%%/*}"
goarch="${platform##*/}"

case "$goos/$goarch" in
  windows/amd64)
    echo "ℹ️  Windows amd64 驱动产物不执行 UPX 压缩：$label"
    exit 0
    ;;
  linux/amd64|linux/arm64)
    ;;
  *)
    echo "ℹ️  UPX 跳过不支持的平台：$label ($platform)"
    exit 0
    ;;
esac

host_platform="$(go env GOOS)/$(go env GOARCH)"

is_driver_agent_binary() {
  local artifact_name
  artifact_name="$(basename "$artifact_path")"
  [[ "$artifact_name" == *"-driver-agent-"* ]]
}

can_smoke_test_driver_agent() {
  is_driver_agent_binary && [[ "$host_platform" == "$platform" ]]
}

smoke_test_driver_agent_metadata() {
  local stdout_file stderr_file
  stdout_file="$(mktemp "${TMPDIR:-/tmp}/gonavi-driver-agent-stdout.XXXXXX")"
  stderr_file="$(mktemp "${TMPDIR:-/tmp}/gonavi-driver-agent-stderr.XXXXXX")"

  if ! printf '%s\n' '{"id":1,"method":"metadata"}' | "$artifact_path" >"$stdout_file" 2>"$stderr_file"; then
    [[ -s "$stderr_file" ]] && cat "$stderr_file" >&2
    rm -f "$stdout_file" "$stderr_file"
    return 1
  fi

  if ! python3 - "$stdout_file" <<'PY'
import json
import sys
from pathlib import Path

lines = [line.strip() for line in Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace").splitlines() if line.strip()]
if not lines:
    raise SystemExit(1)

payload = json.loads(lines[0])
if not payload.get("success"):
    raise SystemExit(1)

data = payload.get("data") or {}
if not str(data.get("agentRevision") or "").strip():
    raise SystemExit(1)
PY
  then
    [[ -s "$stderr_file" ]] && cat "$stderr_file" >&2
    rm -f "$stdout_file" "$stderr_file"
    return 1
  fi

  rm -f "$stdout_file" "$stderr_file"
  return 0
}

if ! command -v upx >/dev/null 2>&1; then
  if [[ "$mode" == "required" ]]; then
    echo "❌ 未找到 upx，无法压缩：$label" >&2
    exit 1
  fi
  echo "⚠️  未找到 upx，跳过压缩：$label"
  exit 0
fi

file_size_bytes() {
  local path="$1"
  if stat -c%s "$path" >/dev/null 2>&1; then
    stat -c%s "$path"
    return
  fi
  if stat -f%z "$path" >/dev/null 2>&1; then
    stat -f%z "$path"
    return
  fi
  wc -c <"$path" | tr -d '[:space:]'
}

format_size_mb() {
  local bytes="${1:-0}"
  awk -v b="$bytes" 'BEGIN { printf "%.2fMB", b / 1024 / 1024 }'
}

backup_path="$(mktemp "${TMPDIR:-/tmp}/gonavi-upx-artifact.XXXXXX")"
cp "$artifact_path" "$backup_path"
cleanup() {
  rm -f "$backup_path"
}
trap cleanup EXIT

before_bytes="$(file_size_bytes "$artifact_path")"
echo "🗜️  UPX 压缩驱动产物：$label"

if ! upx --best --lzma --force "$artifact_path" >/dev/null 2>&1; then
  cp "$backup_path" "$artifact_path"
  if [[ "$mode" == "required" ]]; then
    echo "❌ UPX 压缩失败：$label" >&2
    exit 1
  fi
  echo "⚠️  UPX 压缩失败，已恢复原文件：$label"
  exit 0
fi

if ! upx -t "$artifact_path" >/dev/null 2>&1; then
  cp "$backup_path" "$artifact_path"
  if [[ "$mode" == "required" ]]; then
    echo "❌ UPX 校验失败：$label" >&2
    exit 1
  fi
  echo "⚠️  UPX 校验失败，已恢复原文件：$label"
  exit 0
fi

if can_smoke_test_driver_agent; then
  if ! smoke_test_driver_agent_metadata; then
    cp "$backup_path" "$artifact_path"
    if [[ "$mode" == "required" ]]; then
      echo "❌ UPX 压缩后 driver-agent metadata 自检失败：$label" >&2
      exit 1
    fi
    echo "⚠️  UPX 压缩后 driver-agent metadata 自检失败，已恢复原文件：$label"
    # Still smoke-test the restored (uncompressed) artifact so a permanently
    # broken binary fails the build step instead of surfacing later as empty revision.
    if ! smoke_test_driver_agent_metadata; then
      echo "❌ 恢复未压缩产物后 metadata 仍失败：$label" >&2
      exit 1
    fi
    exit 0
  fi
fi

after_bytes="$(file_size_bytes "$artifact_path")"
if [[ "$after_bytes" -lt "$before_bytes" ]]; then
  saved_bytes=$((before_bytes - after_bytes))
  echo "✅ UPX 压缩完成：$label $(format_size_mb "$before_bytes") -> $(format_size_mb "$after_bytes")，减少 $(format_size_mb "$saved_bytes")"
else
  echo "ℹ️  UPX 压缩完成：$label $(format_size_mb "$before_bytes") -> $(format_size_mb "$after_bytes")"
fi
