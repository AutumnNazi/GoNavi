#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 5 ]]; then
    echo "usage: $0 ROOT STAGING_DIR CHANNEL APP_TAG DRIVER_TAG" >&2
    exit 2
fi

root="$1"
staging_dir="$2"
channel="$3"
app_tag="$4"
driver_tag="$5"

validate_tag() {
    local value="$1"
    local label="$2"
    if [[ ! "${value}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ || "${value}" == "." || "${value}" == ".." ]]; then
        echo "invalid ${label}: ${value}" >&2
        exit 1
    fi
}

[[ "${root}" == /* && "${root}" != "/" ]] || {
    echo "mirror root must be an absolute non-root path" >&2
    exit 1
}
[[ -d "${root}" ]] || {
    echo "mirror root does not exist: ${root}" >&2
    exit 1
}
root="$(cd "${root}" && pwd -P)"
[[ "$(cat "${root}/.gonavi-mirror-root" 2>/dev/null || true)" == "gonavi-download-mirror-v1" ]] || {
    echo "mirror root marker is missing or invalid" >&2
    exit 1
}

[[ -d "${staging_dir}" ]] || {
    echo "staging directory does not exist: ${staging_dir}" >&2
    exit 1
}
staging_dir="$(cd "${staging_dir}" && pwd -P)"
case "${staging_dir}" in
    "${root}/.incoming/"*) ;;
    *)
        echo "staging directory must be below ${root}/.incoming" >&2
        exit 1
        ;;
esac

lock_dir=""
cleanup() {
    local exit_code=$?
    trap - EXIT
    set +e
    if [[ -n "${lock_dir}" ]]; then
        rmdir "${lock_dir}" 2>/dev/null || true
    fi
    rm -rf -- "${staging_dir}"
    exit "${exit_code}"
}
trap cleanup EXIT

[[ "${channel}" == "stable" || "${channel}" == "dev" ]] || {
    echo "invalid channel: ${channel}" >&2
    exit 1
}
validate_tag "${app_tag}" "app tag"
if [[ -n "${driver_tag}" ]]; then
    validate_tag "${driver_tag}" "driver tag"
fi

payload_dir="${staging_dir}/payload"
[[ -d "${payload_dir}" && -s "${staging_dir}/SHA256SUMS" ]] || {
    echo "staged payload or SHA256SUMS is missing" >&2
    exit 1
}
if [[ -n "$(find "${staging_dir}" -type l -print -quit)" ]]; then
    echo "symbolic links are not allowed in a mirror deployment" >&2
    exit 1
fi
if grep -Eq '(^|[[:space:]])(/|\.\.?/)' "${staging_dir}/SHA256SUMS"; then
    echo "unsafe path in SHA256SUMS" >&2
    exit 1
fi

if command -v flock >/dev/null 2>&1; then
    exec 9>"${root}/.deploy.lock"
    flock 9
else
    lock_dir="${root}/.deploy.lock.d"
    mkdir "${lock_dir}"
fi

if command -v sha256sum >/dev/null 2>&1; then
    (cd "${payload_dir}" && sha256sum --check "${staging_dir}/SHA256SUMS")
else
    (cd "${payload_dir}" && shasum -a 256 --check "${staging_dir}/SHA256SUMS")
fi

promote_immutable_directory() {
    local source="$1"
    local destination="$2"
    [[ -d "${source}" ]] || {
        echo "immutable source directory is missing: ${source}" >&2
        exit 1
    }
    mkdir -p "$(dirname "${destination}")"
    if [[ -e "${destination}" ]]; then
        [[ -d "${destination}" ]] || {
            echo "immutable destination is not a directory: ${destination}" >&2
            exit 1
        }
        if ! diff -qr "${source}" "${destination}" >/dev/null; then
            echo "refusing to overwrite immutable mirror directory: ${destination}" >&2
            exit 1
        fi
        rm -rf -- "${source}"
    else
        mv "${source}" "${destination}"
    fi
}

promote_mutable_file() {
    local source="$1"
    local destination="$2"
    local temporary
    [[ -f "${source}" ]] || {
        echo "mutable source file is missing: ${source}" >&2
        exit 1
    }
    mkdir -p "$(dirname "${destination}")"
    temporary="${destination}.tmp.$$"
    mv "${source}" "${temporary}"
    chmod 0644 "${temporary}"
    mv -f "${temporary}" "${destination}"
}

prune_other_versions() {
    local parent="$1"
    local keep="$2"
    local candidate
    [[ "${parent}" == "${root}/"* && "${parent}" != "${root}" ]] || {
        echo "refusing unsafe prune root: ${parent}" >&2
        exit 1
    }
    [[ -d "${parent}" ]] || return 0
    for candidate in "${parent}"/*; do
        [[ -e "${candidate}" ]] || continue
        [[ -d "${candidate}" ]] || {
            echo "unexpected file in version root: ${candidate}" >&2
            exit 1
        }
        if [[ "$(basename "${candidate}")" != "${keep}" ]]; then
            rm -rf -- "${candidate}"
        fi
    done
}

if [[ "${channel}" == "stable" ]]; then
    app_download_parent="${root}/gonavi/releases/download"
    app_latest_source="${payload_dir}/gonavi/releases/latest/latest.json"
    app_latest_destination="${root}/gonavi/releases/latest/latest.json"
    driver_download_parent="${root}/drivers/releases/download"
    driver_latest_source="${payload_dir}/drivers/releases/latest/GoNavi-DriverAgents-Index.json"
    driver_latest_destination="${root}/drivers/releases/latest/GoNavi-DriverAgents-Index.json"
else
    app_download_parent="${root}/gonavi/dev/releases/download"
    app_latest_source="${payload_dir}/gonavi/dev/releases/latest/latest-dev.json"
    app_latest_destination="${root}/gonavi/dev/releases/latest/latest-dev.json"
    driver_download_parent="${root}/drivers/dev/releases/download"
    driver_latest_source="${payload_dir}/drivers/dev/releases/latest/GoNavi-DriverAgents-Index.json"
    driver_latest_destination="${root}/drivers/dev/releases/latest/GoNavi-DriverAgents-Index.json"
fi

promote_immutable_directory \
    "${payload_dir}/${app_download_parent#"${root}/"}/${app_tag}" \
    "${app_download_parent}/${app_tag}"

if [[ -n "${driver_tag}" ]]; then
    promote_immutable_directory \
        "${payload_dir}/${driver_download_parent#"${root}/"}/${driver_tag}" \
        "${driver_download_parent}/${driver_tag}"
fi

# Mutable pointers are the commit point and move only after all immutable files verify.
promote_mutable_file "${app_latest_source}" "${app_latest_destination}"
if [[ -n "${driver_tag}" ]]; then
    promote_mutable_file "${driver_latest_source}" "${driver_latest_destination}"
fi

prune_other_versions "${app_download_parent}" "${app_tag}"
if [[ -n "${driver_tag}" ]]; then
    prune_other_versions "${driver_download_parent}" "${driver_tag}"
fi

rm -rf -- "${staging_dir}"
echo "VPS mirror deployment committed: channel=${channel} app=${app_tag} driver=${driver_tag:-unchanged}"
du -sk "${root}"
