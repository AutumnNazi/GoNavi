#!/usr/bin/env python3
"""Prune GoNavi dev-only container package versions on GHCR.

The Docker Images workflow used to publish a permanent ``dev-<sha>`` tag for
every push to ``dev``.  Those snapshots dominate the package version list and
push version tags such as ``0.9.8`` off the first page, so operators cannot
locate a tag to pin in Kubernetes.  The workflow no longer creates them; this
tool removes the historical backlog.

A version is prunable only when **every** tag it carries matches
``dev-<7 hex>``.  That single rule keeps all three dangerous cases out of
scope:

* ``dev-latest``      -> the rolling pointer still references the build
* ``latest``/``0.9.8``-> stable release tags are never dev snapshots
* no tags at all      -> multi-arch child manifests; deleting them would
                         break the platform indexes of every image

The tool is dry-run by default; deletion requires an explicit ``--apply``.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_OWNER = "syngnat"
DEFAULT_IMAGES = (
    "gonavi-web-server",
    "gonavi-mcp-server",
    "gonavi-cli",
    "gonavi-build-env",
)
DEFAULT_API_BASE = "https://api.github.com"
DEFAULT_TOKEN_ENV = "GH_TOKEN"
DEFAULT_MIN_AGE_DAYS = 0
PAGE_SIZE = 100

# ``dev-`` followed by the 7-character short SHA produced by docker/metadata-action.
DEV_SNAPSHOT_RE = re.compile(r"^dev-[0-9a-f]{7}$")
IMAGE_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")


def select_prunable_versions(
    versions: list[dict[str, object]], min_age_seconds: int = 0, now: int | None = None
) -> list[dict[str, object]]:
    """Return the versions that are safe to delete.

    ``versions`` mirrors the GitHub container-package versions payload.  A
    version qualifies only when it has at least one tag and every tag is a
    dev snapshot; anything else is preserved.
    """
    if min_age_seconds < 0:
        raise ValueError("minimum retention age must not be negative")
    import time

    cutoff = (int(time.time()) if now is None else now) - min_age_seconds
    selected: list[dict[str, object]] = []
    for version in versions:
        raw_tags = version.get("metadata", {})
        if not isinstance(raw_tags, dict):
            raise ValueError(f"invalid version metadata: {version.get('id')!r}")
        container = raw_tags.get("container", {})
        if not isinstance(container, dict):
            raise ValueError(f"invalid container metadata: {version.get('id')!r}")
        tags = container.get("tags", [])
        if not isinstance(tags, list):
            raise ValueError(f"invalid tag list: {version.get('id')!r}")
        if not tags:
            continue
        # Reject non-string tags instead of letting ``all()`` swallow them: a
        # malformed payload must fail loudly rather than masquerade as a
        # "not a dev snapshot, keep it" decision.
        for tag in tags:
            if not isinstance(tag, str):
                raise ValueError(f"invalid tag entry: {tag!r} in version {version.get('id')!r}")
        if not all(DEV_SNAPSHOT_RE.fullmatch(tag) for tag in tags):
            continue
        created_at = version.get("updated_at") or version.get("created_at")
        if not isinstance(created_at, str):
            raise ValueError(f"version {version.get('id')!r} has no timestamp")
        created = parse_timestamp(created_at)
        if min_age_seconds and created > cutoff:
            continue
        selected.append(version)
    return selected


def parse_timestamp(value: str) -> int:
    """Parse a GitHub ISO-8601 timestamp into epoch seconds."""
    import datetime

    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.datetime.fromisoformat(text)
    except ValueError as error:
        raise ValueError(f"invalid timestamp: {value!r}") from error
    if parsed.tzinfo is None:
        raise ValueError(f"timestamp is missing a timezone: {value!r}")
    return int(parsed.timestamp())


def build_url(api_base: str, owner: str, image: str, page: int) -> str:
    package = urllib.parse.quote(f"container/{image}", safe="/")
    query = urllib.parse.urlencode(
        {
            "package_type": "container",
            "per_page": PAGE_SIZE,
            "page": page,
        }
    )
    return f"{api_base}/users/{urllib.parse.quote(owner)}/packages/{package}/versions?{query}"


def request_json(url: str, token: str) -> object:
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "gonavi-ghcr-dev-prune",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise ValueError(f"GitHub API {error.code} for {url}: {detail}") from error


def list_versions(api_base: str, owner: str, image: str, token: str) -> list[dict[str, object]]:
    versions: list[dict[str, object]] = []
    page = 1
    while True:
        payload = request_json(build_url(api_base, owner, image, page), token)
        if not isinstance(payload, list):
            raise ValueError(f"unexpected versions payload for {image}")
        if not payload:
            return versions
        for entry in payload:
            if not isinstance(entry, dict):
                raise ValueError(f"unexpected version entry for {image}")
            versions.append(entry)
        if len(payload) < PAGE_SIZE:
            return versions
        page += 1


def delete_version(api_base: str, owner: str, image: str, version_id: object, token: str) -> None:
    package = urllib.parse.quote(f"container/{image}", safe="/")
    url = (
        f"{api_base}/users/{urllib.parse.quote(owner)}/packages/{package}"
        f"/versions/{urllib.parse.quote(str(version_id))}"
    )
    request = urllib.request.Request(
        url,
        method="DELETE",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "gonavi-ghcr-dev-prune",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60):
            return
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise ValueError(f"GitHub API {error.code} deleting {image}@{version_id}: {detail}") from error


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", default=DEFAULT_OWNER)
    parser.add_argument("--image", action="append", dest="images", default=None)
    parser.add_argument("--api-base", default=DEFAULT_API_BASE)
    parser.add_argument("--token-env", default=DEFAULT_TOKEN_ENV)
    parser.add_argument("--min-age-days", type=int, default=DEFAULT_MIN_AGE_DAYS)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    images = args.images or list(DEFAULT_IMAGES)
    for image in images:
        if not IMAGE_NAME_RE.fullmatch(image):
            print(f"invalid image name: {image!r}", file=sys.stderr)
            return 2
    if args.min_age_days < 0:
        print("minimum retention age must not be negative", file=sys.stderr)
        return 2

    token = os.environ.get(args.token_env, "").strip()
    if not token:
        print(f"{args.token_env} is required; run 'gh auth refresh -s delete:packages'", file=sys.stderr)
        return 2

    min_age_seconds = args.min_age_days * 86400
    report: dict[str, object] = {"dryRun": not args.apply, "images": {}}
    failures = 0
    try:
        for image in images:
            versions = list_versions(args.api_base, args.owner, image, token)
            selected = select_prunable_versions(versions, min_age_seconds)
            if args.apply:
                for version in selected:
                    delete_version(args.api_base, args.owner, image, version["id"], token)
            report["images"][image] = {
                "totalVersions": len(versions),
                "deletedVersions": len(selected),
            }
        report["deletedVersions"] = sum(
            entry["deletedVersions"] for entry in report["images"].values()  # type: ignore[union-attr]
        )
    except ValueError as error:
        print(str(error), file=sys.stderr)
        failures = 2

    print(json.dumps(report, separators=(",", ":"), sort_keys=True))
    return failures


if __name__ == "__main__":
    raise SystemExit(main())
