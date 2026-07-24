#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TEMP_DIR}"' EXIT

# The no-flock fallback must share the staging cleanup trap instead of replacing it.
test "$(grep -c '^trap cleanup EXIT$' "${SCRIPT_DIR}/vps-release-commit.sh")" -eq 1
test "$(grep -c "trap 'rmdir" "${SCRIPT_DIR}/vps-release-commit.sh")" -eq 0

ROOT="${TEMP_DIR}/mirror"
SOURCE="${TEMP_DIR}/source"
mkdir -p "${ROOT}/.incoming" "${SOURCE}/app" "${SOURCE}/driver"
printf '%s\n' 'gonavi-download-mirror-v1' > "${ROOT}/.gonavi-mirror-root"
printf '%s' 'portable zip' > "${SOURCE}/app/GoNavi.zip"
printf '%s' 'driver archive' > "${SOURCE}/driver/mysql-driver-agent-windows-amd64.zip"

python3 - "${SOURCE}" <<'PY'
import hashlib
import json
import pathlib
import sys
import zipfile

source = pathlib.Path(sys.argv[1])
app = (source / "app/GoNavi.zip").read_bytes()
(source / "app/latest.json").write_text(json.dumps({
    "tagName": "v1.2.3",
    "assets": [{
        "name": "GoNavi.zip",
        "size": len(app),
        "sha256": hashlib.sha256(app).hexdigest(),
    }],
}))
driver_name = "mysql-driver-agent-windows-amd64.zip"
driver_entry_name = "mysql-driver-agent-windows-amd64.exe"
driver_entry_path = f"Windows/{driver_entry_name}"
driver_entry = b"driver binary"
with zipfile.ZipFile(source / "driver" / driver_name, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr(driver_entry_path, driver_entry)
driver_archive = (source / "driver" / driver_name).read_bytes()
index = {
    "assets": {driver_name: len(driver_archive)},
    "assetSha256": {driver_name: hashlib.sha256(driver_archive).hexdigest()},
    "entries": {
        driver_entry_name: {
            "archive": driver_name,
            "path": driver_entry_path,
            "size": len(driver_entry),
            "sha256": hashlib.sha256(driver_entry).hexdigest(),
        }
    },
}
(source / "driver/version.json").write_text(json.dumps({**index, "tagName": "v1.2.3"}))
(source / "driver/latest.json").write_text(json.dumps({**index, "tagName": "latest", "mirrorTagName": "v1.2.3"}))
PY

prepare_stable() {
    local output="$1"
    python3 "${SCRIPT_DIR}/prepare-vps-release-payload.py" \
        --channel stable \
        --app-tag v1.2.3 \
        --app-dir "${SOURCE}/app" \
        --app-manifest "${SOURCE}/app/latest.json" \
        --driver-tag v1.2.3 \
        --driver-dir "${SOURCE}/driver" \
        --driver-version-index "${SOURCE}/driver/version.json" \
        --driver-latest-index "${SOURCE}/driver/latest.json" \
        --output "${output}" >/dev/null
}

mkdir -p "${ROOT}/gonavi/releases/download/v0.9.0" \
    "${ROOT}/drivers/releases/download/v0.9.0"
prepare_stable "${ROOT}/.incoming/stable-1"
bash "${SCRIPT_DIR}/vps-release-commit.sh" \
    "${ROOT}" "${ROOT}/.incoming/stable-1" stable v1.2.3 v1.2.3 >/dev/null

test -f "${ROOT}/gonavi/releases/download/v1.2.3/GoNavi.zip"
test -f "${ROOT}/gonavi/releases/latest/latest.json"
test -f "${ROOT}/drivers/releases/download/v1.2.3/mysql-driver-agent-windows-amd64.zip"
test -f "${ROOT}/drivers/releases/latest/GoNavi-DriverAgents-Index.json"
test ! -e "${ROOT}/gonavi/releases/download/v0.9.0"
test ! -e "${ROOT}/drivers/releases/download/v0.9.0"

# Replaying the same immutable release is idempotent.
prepare_stable "${ROOT}/.incoming/stable-2"
bash "${SCRIPT_DIR}/vps-release-commit.sh" \
    "${ROOT}" "${ROOT}/.incoming/stable-2" stable v1.2.3 v1.2.3 >/dev/null

# A checksum failure must not move the mutable pointer.
printf '%s' 'dev payload' > "${SOURCE}/app/GoNavi-dev.zip"
python3 - "${SOURCE}" <<'PY'
import hashlib
import json
import pathlib
import sys

source = pathlib.Path(sys.argv[1])
app = (source / "app/GoNavi-dev.zip").read_bytes()
(source / "app/latest-dev.json").write_text(json.dumps({
    "channel": "dev",
    "version": "dev-abc123",
    "assets": [{
        "name": "GoNavi-dev.zip",
        "size": len(app),
        "sha256": hashlib.sha256(app).hexdigest(),
    }],
}))
PY
python3 "${SCRIPT_DIR}/prepare-vps-release-payload.py" \
    --channel dev \
    --app-tag dev-abc123 \
    --app-dir "${SOURCE}/app" \
    --app-manifest "${SOURCE}/app/latest-dev.json" \
    --output "${ROOT}/.incoming/dev-1" >/dev/null
printf '%s' 'tampered' >> "${ROOT}/.incoming/dev-1/payload/gonavi/dev/releases/download/dev-abc123/GoNavi-dev.zip"
if bash "${SCRIPT_DIR}/vps-release-commit.sh" \
    "${ROOT}" "${ROOT}/.incoming/dev-1" dev dev-abc123 '' >/dev/null 2>&1; then
    echo "expected tampered payload to fail" >&2
    exit 1
fi
test ! -e "${ROOT}/gonavi/dev/releases/latest/latest-dev.json"
test ! -e "${ROOT}/.incoming/dev-1"
test ! -e "${ROOT}/.deploy.lock.d"

# A driver-disabled dev deployment must not prune stable or existing dev driver assets.
mkdir -p "${ROOT}/gonavi/dev/releases/download/dev-old" \
    "${ROOT}/drivers/dev/releases/download/dev-driver-old" \
    "${ROOT}/drivers/dev/releases/latest"
printf '%s' 'old driver pointer' > "${ROOT}/drivers/dev/releases/latest/GoNavi-DriverAgents-Index.json"
python3 "${SCRIPT_DIR}/prepare-vps-release-payload.py" \
    --channel dev \
    --app-tag dev-abc123 \
    --app-dir "${SOURCE}/app" \
    --app-manifest "${SOURCE}/app/latest-dev.json" \
    --output "${ROOT}/.incoming/dev-2" >/dev/null
bash "${SCRIPT_DIR}/vps-release-commit.sh" \
    "${ROOT}" "${ROOT}/.incoming/dev-2" dev dev-abc123 '' >/dev/null

test -f "${ROOT}/gonavi/dev/releases/download/dev-abc123/GoNavi-dev.zip"
test ! -e "${ROOT}/gonavi/dev/releases/download/dev-old"
test -d "${ROOT}/drivers/dev/releases/download/dev-driver-old"
test "$(cat "${ROOT}/drivers/dev/releases/latest/GoNavi-DriverAgents-Index.json")" = 'old driver pointer'
test -d "${ROOT}/gonavi/releases/download/v1.2.3"
test -d "${ROOT}/drivers/releases/download/v1.2.3"
test ! -e "${ROOT}/.incoming/dev-2"

echo "vps release commit tests passed"
