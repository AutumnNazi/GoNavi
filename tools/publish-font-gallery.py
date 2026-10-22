#!/usr/bin/env python3
"""GoNavi font gallery publisher.

Content-addresses original font files, builds the merged catalog.json payload and
a publication record. Offline and deterministic: font bytes are never modified;
a font above the 512 KiB preview bound gets a name-preserving subset preview that
only covers the application's preview text. The publisher never uploads; pushing
the staged payload to Bero follows docs/font-gallery-operations.md.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

MAX_FONT_BYTES = 32 * 1024 * 1024
MAX_PREVIEW_BYTES = 512 * 1024
MAX_CATALOG_ENTRIES = 64
ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
VERSION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
FAMILY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _-]{0,127}$")
HASH_PATTERN = re.compile(r"^[a-f0-9]{64}$")
EXTRA_PREVIEW_UNICODES = [
    0x00A0, 0x00B7, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022,
    0x2026, 0x2192, 0x21D2, 0x2260, 0x2264, 0x2265, 0x3000, 0x3001, 0x3002,
    0x3008, 0x3009, 0x300A, 0x300B, 0x3010, 0x3011, 0xFF01, 0xFF08, 0xFF09,
    0xFF0C, 0xFF1A, 0xFF1B, 0xFF1F,
]


class PublishError(Exception):
    """Raised with a machine-readable code mirroring the Go client codes."""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_bytes(path: Path, limit: int, code: str) -> bytes:
    if not path.is_file():
        raise PublishError(f"{code}: missing file {path}")
    data = path.read_bytes()
    if not data or len(data) > limit:
        raise PublishError(f"{code}: {path.name} size {len(data)} outside 1..{limit}")
    return data


def font_family_names(data: bytes) -> list[str]:
    """Return decoded family-name candidates (typographic family preferred, Windows platform first).

    Mac-platform CJK records decode to garbage via latin-1, so Windows (platform 3)
    records sort first and the caller matches the declared family against any candidate.
    """
    try:
        font = TTFont(io.BytesIO(data), fontNumber=0, lazy=True)
        name_table = font["name"]
        candidates: list[tuple[bool, str]] = []
        for name_id in (16, 1):
            for record in name_table.names:
                if record.nameID != name_id:
                    continue
                try:
                    value = (record.toUnicode() or "").strip()
                except Exception:  # noqa: BLE001 - undecodable legacy records are skipped
                    continue
                if value:
                    candidates.append((record.platformID == 3, value))
            if candidates:
                candidates.sort(key=lambda item: item[0], reverse=True)
                return [value for _, value in candidates]
    except Exception as error:  # noqa: BLE001 - any parse failure is an integrity error
        raise PublishError(f"integrity: unreadable font: {error}") from error
    raise PublishError("integrity: font family name is missing")


def family_matches(declared: str, candidates: list[str]) -> bool:
    normalize = lambda value: re.sub(r"\s+", " ", value).strip().casefold()
    target = normalize(declared)
    return any(normalize(value) == target for value in candidates)


def build_subset(data: bytes, destination: Path, preview_text: str, level: int) -> None:
    """Subset one font down to the preview text, keeping every name record.

    Level 0 keeps all layout features; level 1 drops GSUB/GPOS (ligatures and kerning,
    which some fonts ship in bulk); level 2 also limits glyphs to the preview text itself.
    """
    options = subset.Options()
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.name_legacy = True
    options.glyph_names = False
    options.notdef_outline = True
    options.layout_features = ["*"] if level == 0 else []
    unicodes = list(range(0x20, 0x7F)) + (EXTRA_PREVIEW_UNICODES if level <= 1 else [])
    font = subset.load_font(io.BytesIO(data), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=unicodes, text=preview_text)
    subsetter.subset(font)
    subset.save_font(font, destination, options)


def validate_batch_entry(entry: dict) -> None:
    if not ID_PATTERN.match(entry.get("id", "")):
        raise PublishError(f"invalid_catalog: bad id {entry.get('id')!r}")
    if not VERSION_PATTERN.match(entry.get("version", "")):
        raise PublishError(f"invalid_catalog: bad version {entry.get('version')!r}")
    if entry.get("kind") not in ("ui", "mono"):
        raise PublishError(f"invalid_catalog: bad kind {entry.get('kind')!r}")
    if not FAMILY_PATTERN.match(entry.get("family", "")):
        raise PublishError(f"invalid_catalog: bad family {entry.get('family')!r}")
    if not isinstance(entry.get("names"), dict) or not 1 <= len(entry["names"]) <= 16:
        raise PublishError(f"invalid_catalog: bad names for {entry['id']}")
    for field, limit in (("description", 2048), ("useCase", 1024), ("attribution", 8192)):
        if not entry.get(field) or len(entry[field]) > limit:
            raise PublishError(f"invalid_catalog: {field} missing or oversized for {entry['id']}")
    license_record = entry.get("license") or {}
    if not isinstance(license_record.get("nonCommercial"), bool):
        raise PublishError(f"invalid_catalog: license nonCommercial missing for {entry['id']}")
    source_url = license_record.get("url", "")
    if not source_url.startswith("https://") or len(source_url) > 2048:
        raise PublishError(f"invalid_catalog: license url rejected for {entry['id']}")


def asset_record(data: bytes, mime_type: str = "font/ttf") -> dict:
    sha = digest(data)
    extension = "ttf" if mime_type == "font/ttf" else "otf"
    return {
        "path": f"assets/{sha}.{extension}",
        "sha256": sha,
        "sizeBytes": len(data),
        "mimeType": mime_type,
    }


def prepare(orig_dir: Path, batch: dict, out_dir: Path, previous_catalog: dict | None,
            preview_text_path: Path | None) -> dict:
    entries = batch.get("entries") or []
    if not entries:
        raise PublishError("invalid_catalog: batch has no entries")
    batch_ids = [entry.get("id") for entry in entries]
    if len(batch_ids) != len(set(batch_ids)):
        raise PublishError("invalid_catalog: duplicate entry id in batch")
    for entry in entries:
        validate_batch_entry(entry)
    preview_text = ""
    if preview_text_path is not None:
        preview_text = preview_text_path.read_text(encoding="utf-8")
        if not preview_text.strip():
            raise PublishError("invalid_catalog: preview text file is empty")

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "assets").mkdir(exist_ok=True)
    (out_dir / "licenses").mkdir(exist_ok=True)

    built: list[dict] = []
    for entry in entries:
        font_path = orig_dir / entry["fontFile"]
        font_data = read_bytes(font_path, MAX_FONT_BYTES, "download_failed")
        if not font_path.name.lower().endswith(".ttf"):
            raise PublishError(f"invalid_catalog: {entry['id']} must ship a .ttf (nginx serves ttf only)")
        family_candidates = font_family_names(font_data)
        if not family_matches(entry["family"], family_candidates):
            raise PublishError(
                f"integrity: {entry['id']} family mismatch: declared {entry['family']!r}, font offers "
                f"{family_candidates[:3]!r}")
        font_asset = asset_record(font_data)

        preview_bytes = font_data
        preview_policy = "reuse-original-bytes"
        if len(font_data) > MAX_PREVIEW_BYTES:
            if not preview_text:
                raise PublishError(f"invalid_catalog: {entry['id']} needs a preview text file")
            temp_preview = out_dir / f".preview-{entry['id']}.ttf"
            for level in (0, 1, 2):
                build_subset(font_data, temp_preview, preview_text, level)
                if temp_preview.stat().st_size <= MAX_PREVIEW_BYTES:
                    break
            preview_bytes = temp_preview.read_bytes()
            temp_preview.unlink()
            if len(preview_bytes) > MAX_PREVIEW_BYTES:
                raise PublishError(
                    f"invalid_catalog: {entry['id']} preview subset is {len(preview_bytes)} bytes, over 512 KiB")
            if not family_matches(entry["family"], font_family_names(preview_bytes)):
                raise PublishError(f"integrity: {entry['id']} preview subset lost the family name")
            preview_policy = "subset-preview"

        license_path = orig_dir / entry["license"]["licenseFile"]
        license_text = read_bytes(license_path, 65536, "invalid_catalog").decode("utf-8")
        preview_statement = ("Preview uses the identical file." if preview_policy == "reuse-original-bytes"
                             else "Preview is a name-preserving subset covering the application preview text.")
        notice = (f"{entry['attribution']}\nSource: {entry['sourceUrl']}\n"
                  f"Original font bytes are unmodified. {preview_statement} No endorsement is implied.")

        asset_dir = out_dir / "assets"
        (asset_dir / f"{font_asset['sha256']}.ttf").write_bytes(font_data)
        if preview_bytes is font_data or preview_bytes == font_data:
            preview_asset = dict(font_asset)
        else:
            preview_asset = asset_record(preview_bytes)
            (asset_dir / f"{preview_asset['sha256']}.ttf").write_bytes(preview_bytes)
        license_sha = digest(license_text.encode("utf-8"))
        (out_dir / "licenses" / f"{license_sha}.txt").write_text(license_text, encoding="utf-8", newline="\n")

        built.append({
            "id": entry["id"],
            "version": entry["version"],
            "kind": entry["kind"],
            "family": entry["family"],
            "names": dict(entry["names"]),
            "description": entry["description"],
            "useCase": entry["useCase"],
            "font": font_asset,
            "preview": preview_asset,
            "attribution": entry["attribution"],
            "sourceUrl": entry["sourceUrl"],
            "rightsStatus": "approved",
            "license": {
                "id": entry["license"]["id"],
                "name": entry["license"]["name"],
                "url": entry["license"]["url"],
                "notice": notice,
                "text": license_text,
                "nonCommercial": entry["license"]["nonCommercial"],
            },
            "_previewPolicy": preview_policy,
        })

    version = batch["publicationVersion"]
    catalog = merge_catalog(previous_catalog, built, version)
    if len(catalog["entries"]) > MAX_CATALOG_ENTRIES:
        raise PublishError(f"invalid_catalog: {len(catalog['entries'])} entries exceeds the catalog bound")

    record = {
        "catalogVersion": version,
        "publishedAt": batch["publishedAt"],
        "publicBaseURL": batch["publicBaseURL"],
        "catalogSha256": None,
        "catalogSizeBytes": None,
        "fontCount": len(catalog["entries"]),
        "previousCatalogSha256": batch.get("previousCatalogSha256"),
        "upstreamRevision": batch.get("upstreamRevision"),
        "fontFamilies": [entry["family"] for entry in catalog["entries"]],
        "previewMode": "font bytes unmodified; previews reuse the original file under 512 KiB, otherwise a "
                       "name-preserving subset limited to the application's preview text",
        "previewPolicies": {entry["id"]: entry["_previewPolicy"] for entry in catalog["entries"]
                            if "_previewPolicy" in entry},
        "verification": {},
    }
    for entry in catalog["entries"]:
        entry.pop("_previewPolicy", None)
    payload = (json.dumps(catalog, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    (out_dir / "catalog.json").write_bytes(payload)
    record["catalogSha256"] = digest(payload)
    record["catalogSizeBytes"] = len(payload)
    return record


def merge_catalog(previous: dict | None, built: list[dict], version: str) -> dict:
    if not VERSION_PATTERN.match(version):
        raise PublishError(f"invalid_catalog: bad publicationVersion {version!r}")
    if previous is None:
        entries = list(built)
    else:
        if previous.get("schemaVersion") != 1 or not isinstance(previous.get("entries"), list):
            raise PublishError("invalid_catalog: previous catalog is not a v1 catalog")
        built_by_id = {entry["id"]: entry for entry in built}
        replaced = set()
        entries = []
        for entry in previous["entries"]:
            if entry["id"] in built_by_id:
                entries.append(built_by_id[entry["id"]])
                replaced.add(entry["id"])
            else:
                entries.append(entry)
        for entry in sorted(built, key=lambda item: item["id"]):
            if entry["id"] not in replaced:
                entries.append(entry)
    if not entries:
        raise PublishError("invalid_catalog: merged catalog is empty")
    if len(entries) > MAX_CATALOG_ENTRIES:
        raise PublishError(f"invalid_catalog: {len(entries)} entries exceeds the catalog bound")
    ids = [entry["id"] for entry in entries]
    if len(ids) != len(set(ids)):
        raise PublishError("invalid_catalog: duplicate entry id after merge")
    return {"schemaVersion": 1, "version": version, "entries": entries}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", required=True, type=Path, help="batch definition JSON")
    parser.add_argument("--orig-dir", required=True, type=Path, help="directory holding the downloaded originals")
    parser.add_argument("--out", required=True, type=Path, help="staged payload output directory")
    parser.add_argument("--live-catalog", type=Path, help="previous catalog.json to merge into")
    parser.add_argument("--preview-text", type=Path, help="specimen text used to build subset previews")
    args = parser.parse_args()

    batch = json.loads(args.batch.read_text(encoding="utf-8"))
    previous = json.loads(args.live_catalog.read_text(encoding="utf-8")) if args.live_catalog else None
    try:
        record = prepare(args.orig_dir, batch, args.out, previous, args.preview_text)
    except PublishError as error:
        print(f"[publish-font-gallery] {error}", file=sys.stderr)
        return 1
    catalog_path = args.out / "catalog.json"
    record_path = args.out / f"publication-{batch['publicationVersion']}.json"
    record_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[publish-font-gallery] entries={record['fontCount']} "
          f"catalog={record['catalogSha256'][:16]}… ({record['catalogSizeBytes']} bytes)")
    print(f"[publish-font-gallery] payload={args.out} record={record_path.name}")
    print(f"[publish-font-gallery] next: GONAVI_FONT_PUBLICATION_DIR={args.out} "
          f"go test ./internal/fontgallery -run TestPublicationPayload -count=1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
