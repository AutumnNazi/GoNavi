#!/usr/bin/env python3
"""Prune obsolete GoNavi R2 release prefixes and report retained usage.

The script intentionally accepts only the four release roots used by GoNavi.
That guard keeps a malformed workflow variable from turning a retention cleanup
into a bucket-wide delete.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from collections.abc import Iterable, Sequence
from pathlib import PurePosixPath


ALLOWED_RELEASE_ROOTS = frozenset(
    {
        "gonavi/releases/download/",
        "gonavi/dev/releases/download/",
        "drivers/releases/download/",
        "drivers/dev/releases/download/",
    }
)

DRIVER_CHANNELS = {
    "stable": {
        "root": "drivers/releases/download/",
        "pointer": "drivers/releases/latest/GoNavi-DriverAgents-Index.json",
    },
    "dev": {
        "root": "drivers/dev/releases/download/",
        "pointer": "drivers/dev/releases/latest/GoNavi-DriverAgents-Index.json",
    },
}
DRIVER_INDEX_NAME = "GoNavi-DriverAgents-Index.json"
MAX_DRIVER_INDEX_BYTES = 1 << 20


def normalize_prefix(value: str) -> str:
    prefix = (value or "").strip().replace("\\", "/").lstrip("/")
    if not prefix.endswith("/"):
        prefix += "/"
    segments = prefix.rstrip("/").split("/")
    if not prefix or any(segment in {"", ".", ".."} for segment in segments):
        raise ValueError(f"invalid R2 prefix: {value!r}")
    return prefix


def validate_prune_scope(root_prefix: str, keep_prefix: str) -> tuple[str, str]:
    root = normalize_prefix(root_prefix)
    keep = normalize_prefix(keep_prefix)
    if root not in ALLOWED_RELEASE_ROOTS:
        raise ValueError(f"refusing unsupported R2 release root: {root}")
    if keep == root or not keep.startswith(root):
        raise ValueError(f"keep prefix {keep!r} must be a child of {root!r}")
    return root, keep


def select_obsolete_keys(keys: Iterable[str], root_prefix: str, keep_prefix: str) -> list[str]:
    root, keep = validate_prune_scope(root_prefix, keep_prefix)
    return sorted(
        key
        for key in keys
        if key.startswith(root) and not key.startswith(keep)
    )


def chunks(values: Sequence[str], size: int = 1000) -> Iterable[list[str]]:
    if size <= 0:
        raise ValueError("chunk size must be positive")
    for start in range(0, len(values), size):
        yield list(values[start : start + size])


def calculate_retained_bytes(
    objects_by_key: dict[str, int],
    exclude_prefixes: Sequence[str] = (),
    add_bytes: int = 0,
) -> int:
    if add_bytes < 0:
        raise ValueError("added bytes must not be negative")
    excluded = tuple(normalize_prefix(prefix) for prefix in exclude_prefixes)
    retained = sum(
        size
        for key, size in objects_by_key.items()
        if not any(key.startswith(prefix) for prefix in excluded)
    )
    return retained + add_bytes


def run_aws(arguments: list[str]) -> dict:
    proc = subprocess.run(
        ["aws", *arguments, "--no-cli-pager"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        detail = proc.stderr.strip() or proc.stdout.strip() or f"exit {proc.returncode}"
        raise RuntimeError(f"AWS CLI failed: {detail}")
    if not proc.stdout.strip():
        return {}
    payload = json.loads(proc.stdout)
    if not isinstance(payload, dict):
        raise RuntimeError("AWS CLI returned a non-object JSON response")
    return payload


def get_object_json(bucket: str, endpoint_url: str, key: str) -> dict:
    handle, path = tempfile.mkstemp(prefix="gonavi-r2-index-", suffix=".json")
    os.close(handle)
    os.unlink(path)
    try:
        run_aws(
            [
                "s3api",
                "get-object",
                "--bucket",
                bucket,
                "--key",
                key,
                "--endpoint-url",
                endpoint_url,
                path,
                "--output",
                "json",
            ]
        )
        if os.path.getsize(path) > MAX_DRIVER_INDEX_BYTES:
            raise ValueError(f"R2 driver index is too large: {key}")
        with open(path, encoding="utf-8") as stream:
            payload = json.load(stream)
        if not isinstance(payload, dict):
            raise ValueError(f"R2 driver index is not a JSON object: {key}")
        return payload
    finally:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


def list_objects(bucket: str, endpoint_url: str, prefix: str) -> list[dict]:
    objects: list[dict] = []
    continuation_token = ""
    while True:
        args = [
            "s3api",
            "list-objects-v2",
            "--bucket",
            bucket,
            "--prefix",
            prefix,
            "--max-keys",
            "1000",
            "--endpoint-url",
            endpoint_url,
            "--output",
            "json",
        ]
        if continuation_token:
            args.extend(["--continuation-token", continuation_token])
        payload = run_aws(args)
        for item in payload.get("Contents") or []:
            if not isinstance(item, dict):
                continue
            key = str(item.get("Key") or "")
            if key.startswith(prefix):
                objects.append({"Key": key, "Size": int(item.get("Size") or 0)})
        if not payload.get("IsTruncated"):
            break
        continuation_token = str(payload.get("NextContinuationToken") or "")
        if not continuation_token:
            raise RuntimeError("R2 listing was truncated without a continuation token")
    return objects


def delete_objects(bucket: str, endpoint_url: str, keys: Sequence[str]) -> None:
    for batch in chunks(keys):
        payload = run_aws(
            [
                "s3api",
                "delete-objects",
                "--bucket",
                bucket,
                "--delete",
                json.dumps(
                    {"Objects": [{"Key": key} for key in batch], "Quiet": True},
                    separators=(",", ":"),
                ),
                "--endpoint-url",
                endpoint_url,
                "--output",
                "json",
            ]
        )
        errors = payload.get("Errors") or []
        if errors:
            raise RuntimeError(f"R2 delete returned errors: {json.dumps(errors)}")


def validate_driver_pointer_payloads(
    channel: str,
    pointer: dict,
    versioned: dict,
    objects_by_key: dict[str, int],
) -> dict:
    config = DRIVER_CHANNELS.get(channel)
    if config is None:
        raise ValueError(f"unsupported driver channel: {channel}")
    logical_tag = str(pointer.get("tagName") or "").strip()
    if channel == "stable":
        if not re.fullmatch(r"v\d+\.\d+\.\d+", logical_tag):
            raise ValueError("stable driver pointer has an invalid tagName")
        physical_tag = logical_tag
    else:
        if logical_tag != "dev-latest":
            raise ValueError("dev driver pointer tagName must be dev-latest")
        physical_tag = str(pointer.get("mirrorTagName") or "").strip()
        if not re.fullmatch(r"dev-[0-9a-f]{7,40}", physical_tag):
            raise ValueError("dev driver pointer has an invalid mirrorTagName")

    pointer_assets = pointer.get("assets")
    versioned_assets = versioned.get("assets")
    if not isinstance(pointer_assets, dict) or not pointer_assets:
        raise ValueError("driver pointer has no assets")
    if versioned_assets != pointer_assets:
        raise ValueError("versioned driver index does not match the mutable pointer")

    root = str(config["root"])
    keep_prefix = f"{root}{physical_tag}/"
    index_key = keep_prefix + DRIVER_INDEX_NAME
    if objects_by_key.get(index_key, 0) <= 0:
        raise ValueError("versioned driver index is missing from the retained prefix")
    for name, size in pointer_assets.items():
        if not isinstance(name, str) or not name or PurePosixPath(name).name != name:
            raise ValueError(f"invalid driver asset name in pointer: {name!r}")
        if type(size) is not int or size <= 0:
            raise ValueError(f"invalid driver asset size in pointer: {name!r}")
        if objects_by_key.get(keep_prefix + name) != size:
            raise ValueError(f"driver asset is missing or has the wrong size: {name}")
    return {
        "channel": channel,
        "logicalTag": logical_tag,
        "physicalTag": physical_tag,
        "keepPrefix": keep_prefix,
        "assetCount": len(pointer_assets),
    }


def command_prune(args: argparse.Namespace) -> int:
    root, keep = validate_prune_scope(args.root_prefix, args.keep_prefix)
    objects = list_objects(args.bucket, args.endpoint_url, root)
    obsolete = select_obsolete_keys((str(item["Key"]) for item in objects), root, keep)
    obsolete_set = set(obsolete)
    reclaimed_bytes = sum(
        int(item["Size"])
        for item in objects
        if str(item["Key"]) in obsolete_set
    )
    if obsolete and not args.dry_run:
        delete_objects(args.bucket, args.endpoint_url, obsolete)
        remaining = list_objects(args.bucket, args.endpoint_url, root)
        still_obsolete = select_obsolete_keys(
            (str(item["Key"]) for item in remaining),
            root,
            keep,
        )
        if still_obsolete:
            raise RuntimeError(
                f"R2 retention verification found {len(still_obsolete)} obsolete objects"
            )
    print(
        json.dumps(
            {
                "rootPrefix": root,
                "keepPrefix": keep,
                "deletedObjects": len(obsolete),
                "reclaimedBytes": reclaimed_bytes,
                "dryRun": bool(args.dry_run),
            },
            separators=(",", ":"),
        )
    )
    return 0


def command_measure(args: argparse.Namespace) -> int:
    prefixes = [normalize_prefix(prefix) for prefix in args.prefix]
    exclude_prefixes = [normalize_prefix(prefix) for prefix in args.exclude_prefix]
    objects_by_key: dict[str, int] = {}
    for prefix in prefixes:
        for item in list_objects(args.bucket, args.endpoint_url, prefix):
            objects_by_key[str(item["Key"])] = int(item["Size"])
    retained_bytes = calculate_retained_bytes(
        objects_by_key,
        exclude_prefixes,
        args.add_bytes,
    )
    print(
        json.dumps(
            {
                "prefixes": prefixes,
                "excludedPrefixes": exclude_prefixes,
                "retainedObjects": len(objects_by_key),
                "retainedBytes": retained_bytes,
                "addedBytes": args.add_bytes,
                "maxBytes": args.max_bytes,
            },
            separators=(",", ":"),
        )
    )
    if args.max_bytes is not None and retained_bytes > args.max_bytes:
        print(
            f"retained R2 release data {retained_bytes} exceeds budget {args.max_bytes}",
            file=sys.stderr,
        )
        return 3
    return 0


def command_validate_driver_pointer(args: argparse.Namespace) -> int:
    config = DRIVER_CHANNELS[args.channel]
    root = str(config["root"])
    pointer = get_object_json(args.bucket, args.endpoint_url, str(config["pointer"]))
    if args.channel == "stable":
        physical_tag = str(pointer.get("tagName") or "").strip()
    else:
        physical_tag = str(pointer.get("mirrorTagName") or "").strip()
    # Validate the tag before constructing a key from untrusted pointer data.
    if args.channel == "stable" and not re.fullmatch(r"v\d+\.\d+\.\d+", physical_tag):
        raise ValueError("stable driver pointer has an invalid tagName")
    if args.channel == "dev" and not re.fullmatch(r"dev-[0-9a-f]{7,40}", physical_tag):
        raise ValueError("dev driver pointer has an invalid mirrorTagName")
    keep_prefix = f"{root}{physical_tag}/"
    versioned = get_object_json(
        args.bucket,
        args.endpoint_url,
        keep_prefix + DRIVER_INDEX_NAME,
    )
    objects = list_objects(args.bucket, args.endpoint_url, keep_prefix)
    result = validate_driver_pointer_payloads(
        args.channel,
        pointer,
        versioned,
        {str(item["Key"]): int(item["Size"]) for item in objects},
    )
    print(json.dumps(result, separators=(",", ":")))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--bucket", required=True)
    common.add_argument("--endpoint-url", required=True)

    prune = subparsers.add_parser("prune", parents=[common])
    prune.add_argument("--root-prefix", required=True)
    prune.add_argument("--keep-prefix", required=True)
    prune.add_argument("--dry-run", action="store_true")
    prune.set_defaults(handler=command_prune)

    measure = subparsers.add_parser("measure", parents=[common])
    measure.add_argument("--prefix", action="append", required=True)
    measure.add_argument("--exclude-prefix", action="append", default=[])
    measure.add_argument("--add-bytes", type=int, default=0)
    measure.add_argument("--max-bytes", type=int)
    measure.set_defaults(handler=command_measure)

    validate = subparsers.add_parser("validate-driver-pointer", parents=[common])
    validate.add_argument("--channel", choices=tuple(DRIVER_CHANNELS), required=True)
    validate.set_defaults(handler=command_validate_driver_pointer)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.handler(args))
    except (RuntimeError, ValueError, OSError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
