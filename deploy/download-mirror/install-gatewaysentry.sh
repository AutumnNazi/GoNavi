#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
    echo "this installer must run as root" >&2
    exit 1
fi
if [[ $# -ne 1 || ! -f "$1" ]]; then
    echo "usage: $0 PATH_TO_NGINX_CONFIG" >&2
    exit 2
fi

nginx_source="$1"
mirror_user="gonavi-deploy"
mirror_root="/srv/gonavi-downloads"
certificate="/etc/nginx/certs/download.syngnat.top.crt"
private_key="/etc/nginx/certs/download.syngnat.top.key"
site_available="/etc/nginx/sites-available/download.syngnat.top.conf"
site_enabled="/etc/nginx/sites-enabled/download.syngnat.top.conf"

if ! id "${mirror_user}" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "${mirror_user}"
fi
install -d -m 0755 -o "${mirror_user}" -g www-data "${mirror_root}"
install -d -m 0755 -o "${mirror_user}" -g www-data "${mirror_root}/.incoming"
printf '%s\n' 'gonavi-download-mirror-v1' > "${mirror_root}/.gonavi-mirror-root"
printf '%s\n' 'GoNavi download mirror' > "${mirror_root}/health.txt"
chown "${mirror_user}:www-data" \
    "${mirror_root}/.gonavi-mirror-root" \
    "${mirror_root}/health.txt"
chmod 0644 "${mirror_root}/.gonavi-mirror-root" "${mirror_root}/health.txt"

install -d -m 0755 /etc/nginx/certs
if [[ ! -s "${certificate}" || ! -s "${private_key}" ]]; then
    openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 3650 \
        -subj '/CN=download.syngnat.top' \
        -addext 'subjectAltName=DNS:download.syngnat.top' \
        -keyout "${private_key}" \
        -out "${certificate}"
fi
chmod 0600 "${private_key}"
chmod 0644 "${certificate}"

install -m 0644 "${nginx_source}" "${site_available}"
ln -sfn "${site_available}" "${site_enabled}"
nginx -t
systemctl reload nginx

echo "Gatewaysentry download mirror origin installed"
