#!/usr/bin/env python3
"""Prepare the approved gallery offline, outside this repository; never upload.

The explicit source manifest is byte-pinned, not a way to approve new artwork.
Use a trusted external staging directory. Originals are copied byte-for-byte.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import warnings

try:
    from PIL import Image
except ImportError as error:
    raise SystemExit("Pillow with WebP support is required; use the bundled Python. No dependency is auto-installed.") from error

REPO_ROOT = Path(__file__).resolve().parents[1]
PINNED_MANIFEST_SHA256 = "582cde1dcd0695b66ef869bb2bef26f6c0c92a9feffbbcad6f953bb1a4b30359"
REVISION = "15e9aa0bb3a6281d80cee62185c5482b10d46d19"
RAW_BASE = f"https://raw.githubusercontent.com/Small-tailqwq/dsh-deep-whale/{REVISION}/maid-atelier/"
PIXIV_ALBUM = "https://www.pixiv.net/artworks/148186519"
PIXIV_ORIGINAL_BASE = "https://i.pximg.net/img-original/img/2026/08/09/01/18/27/148186519_"
CUSTOM_LICENSE_ID = "LicenseRef-ZipZipPipe-Attribution-NonCommercial"
CC_LICENSE_ID = "CC-BY-NC-SA-4.0"
PIXIV_PAGES = {"glm-maid-portrait": 7, "wenxin-wheelchair": 12, "minimax-maid": 16}
APPROVED = {
    "whale-maid-a": ("maid-left.webp", RAW_BASE + "assets/maid-atelier-maid-left-v5.webp"),
    "whale-maid-b": ("maid-right.webp", RAW_BASE + "assets/maid-atelier-maid-right-v7.webp"),
    **{name: (name + ".jpg", PIXIV_ALBUM) for name in PIXIV_PAGES},
}
LICENSES = {
    CC_LICENSE_ID: {
        "id": CC_LICENSE_ID,
        "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International",
        "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
        "nonCommercial": True,
    },
    CUSTOM_LICENSE_ID: {
        "id": CUSTOM_LICENSE_ID,
        "name": "ZipZipPipe 署名－非商业使用 / Attribution–NonCommercial",
        "url": PIXIV_ALBUM,
        "nonCommercial": True,
    },
}
LICENSE_DOCUMENTS = {
    CC_LICENSE_ID: ("NOTICE", "LICENSE-ARTWORK"),
    CUSTOM_LICENSE_ID: ("NOTICE-ZIPZIPPIPE", "LICENSE-ZIPZIPPIPE"),
}
LOCALES = {"zh-CN", "zh-TW", "en-US", "ja-JP", "ru-RU", "de-DE"}
MAX_IMAGE_BYTES = 16 * 1024 * 1024
MAX_THUMBNAIL_BYTES = 256 * 1024
MAX_PIXELS = 24_000_000
MAX_CATALOG_BYTES = 2 * 1024 * 1024
VERSION_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")
ATTRIBUTION = (
    "上善 → ZipZipPipe → Small-tailqwq. "
    "Original whale-girl design: 上善 (https://www.pixiv.net/users/62155430); "
    "DeepSeek maid redesign (GPT Image 2): ZipZipPipe (https://www.pixiv.net/users/18604994); "
    "tertiary DeepSeek-element design: Small-tailqwq (https://github.com/Small-tailqwq/dsh-deep-whale). "
    "No artist endorsement is implied. CC BY-NC-SA 4.0; non-commercial only; adaptations share alike."
)
MODIFICATIONS = (
    "\nGoNavi remote gallery publication\n"
    "The historical bundled-background notice above is preserved unaltered as provenance, "
    "not a statement that the gallery artwork is bundled in the application. "
    "Original WebP bytes are unchanged. GoNavi thumbnails are proportionally downscaled "
    "(at most 512 pixels per side, with integer-pixel rounding) and losslessly WebP-encoded; "
    "no cropping, redrawing, watermark removal or alpha flattening. "
    "Thumbnails retain CC BY-NC-SA 4.0. Free non-commercial distribution only; "
    "not a paid benefit, advertisement or commercial promotion. Full attribution and "
    "disclaimers remain in this notice and the accompanying complete license text.\n"
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value: dict) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def bounded_regular_read(path: Path, maximum: int) -> bytes:
    """Do not follow final-component links or block opening a FIFO."""
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ValueError(f"cannot read regular file (no symlinks): {path.name}") from error
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise ValueError(f"not a regular file: {path.name}")
        if not 0 < info.st_size <= maximum:
            raise ValueError(f"integrity/size limit exceeded: {path.name}")
        data = stream.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError(f"integrity/size limit exceeded: {path.name}")
    return data


def validate_policy(manifest: dict) -> None:
    if manifest.get("schemaVersion") != 1 or manifest.get("upstreamRevision") != REVISION:
        raise ValueError("source manifest is not the approved revision")
    entries = manifest.get("entries", [])
    if (len(entries) != 5 or {entry.get("id") for entry in entries} != set(APPROVED)
            or any(entry.get("rightsStatus") != "approved" for entry in entries)):
        raise ValueError("only the five approved original entries are allowlisted")
    if manifest.get("licenses") != LICENSES:
        raise ValueError("explicit approved noncommercial artwork licenses required")
    documents = manifest.get("documents", [])
    required = {name for pair in LICENSE_DOCUMENTS.values() for name in pair}
    if len(documents) != len(required) or {item.get("file") for item in documents} != required:
        raise ValueError("complete approved license and notice documents required")
    for entry in entries:
        if (entry.get("file"), entry.get("sourceUrl")) != APPROVED[entry["id"]]:
            raise ValueError("source path/URL is not in the approved allowlist")
        pixiv_page = PIXIV_PAGES.get(entry["id"])
        expected_license = CUSTOM_LICENSE_ID if pixiv_page else CC_LICENSE_ID
        if entry.get("licenseId") != expected_license:
            raise ValueError("entry license assignment is not approved")
        if pixiv_page and (entry.get("author") != "ZipZipPipe"
                           or entry.get("page") != pixiv_page
                           or entry.get("pixivPageIndex") != pixiv_page - 1
                           or entry.get("originalUrl") != PIXIV_ORIGINAL_BASE + f"p{pixiv_page - 1}.jpg"):
            raise ValueError("original URL/page/author is not in the approved allowlist")
        names = entry.get("names", {})
        if set(names) != LOCALES or any(not isinstance(name, str) or not name.strip()
                                       or len(name.encode("utf-8")) > 256 for name in names.values()):
            raise ValueError("all six bounded locale names are required")
        if entry.get("fit") != "contain" or not VERSION_PATTERN.fullmatch(entry.get("version", "")):
            raise ValueError("invalid approved entry metadata")
        if not 0 < entry["width"] * entry["height"] <= MAX_PIXELS:
            raise ValueError("image exceeds pixel limit")


def load_manifest(path: Path) -> dict:
    data = bounded_regular_read(path, 64 * 1024)
    if sha256(data) != PINNED_MANIFEST_SHA256:
        raise ValueError("source manifest does not match the reviewed pin")
    manifest = json.loads(data)
    validate_policy(manifest)
    return manifest


def read_verified(source: Path, item: dict, maximum: int) -> bytes:
    filename = item["file"]
    if Path(filename).name != filename or filename in {"", ".", ".."}:
        raise ValueError("invalid source filename")
    data = bounded_regular_read(source / filename, maximum)
    if len(data) != item["sizeBytes"] or sha256(data) != item["sha256"]:
        raise ValueError(f"source integrity mismatch: {filename}")
    return data


def decode_image(data: bytes) -> Image.Image:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in {"WEBP", "JPEG"} or getattr(image, "n_frames", 1) != 1:
                    raise ValueError("only static JPEG or WebP is approved")
                if image.width <= 0 or image.height <= 0 or image.width * image.height > MAX_PIXELS:
                    raise ValueError("image exceeds pixel limit")
                image.load()
                decoded = image.copy()
                decoded.format = image.format
                return decoded
    except (OSError, Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
        raise ValueError("invalid JPEG/WebP image") from error


def make_thumbnail(data: bytes) -> bytes:
    """Lossless encoding preserves resized pixels and alpha; never crop/upscale."""
    with decode_image(data) as original:
        for edge in (512, 384, 256, 192, 128, 64):
            with original.copy() as image:
                image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
                buffer = io.BytesIO()
                image.save(buffer, format="WEBP", lossless=True, method=6, exact=True)
                result = buffer.getvalue()
                if len(result) <= MAX_THUMBNAIL_BYTES:
                    return result
    raise ValueError("cannot produce a bounded thumbnail")


def asset_metadata(data: bytes, maximum: int) -> dict:
    if not 0 < len(data) <= maximum:
        raise ValueError("asset exceeds byte limit")
    with decode_image(data) as image:
        digest = sha256(data)
        extension, mime = ("jpg", "image/jpeg") if image.format == "JPEG" else ("webp", "image/webp")
        return {"path": f"assets/{digest}.{extension}", "sha256": digest, "sizeBytes": len(data),
                "width": image.width, "height": image.height, "mimeType": mime}


def build_payload(source: Path, manifest: dict, version: str) -> tuple[dict, dict[str, bytes]]:
    documents = {item["file"]: read_verified(source, item, 64 * 1024)
                 for item in manifest["documents"]}
    notice = documents["NOTICE"].decode("utf-8") + MODIFICATIONS
    license_text = documents["LICENSE-ARTWORK"].decode("utf-8")
    license_infos = {
        CC_LICENSE_ID: dict(manifest["licenses"][CC_LICENSE_ID], notice=notice, text=license_text),
        CUSTOM_LICENSE_ID: dict(manifest["licenses"][CUSTOM_LICENSE_ID],
                                notice=documents["NOTICE-ZIPZIPPIPE"].decode("utf-8"),
                                text=documents["LICENSE-ZIPZIPPIPE"].decode("utf-8")),
    }
    for info in license_infos.values():
        if len(info["notice"].encode("utf-8")) > 16 * 1024 or len(info["text"].encode("utf-8")) > 64 * 1024:
            raise ValueError("legal text exceeds catalog limits")
    files = {}
    # Publish the original complete documents as well as the added modification notice.
    for data in [*documents.values(), notice.encode("utf-8")]:
        files[f"licenses/{sha256(data)}.txt"] = data
    entries = []
    for item in manifest["entries"]:
        original = read_verified(source, item, MAX_IMAGE_BYTES)
        image = asset_metadata(original, MAX_IMAGE_BYTES)
        expected_mime = "image/jpeg" if item["id"] in PIXIV_PAGES else "image/webp"
        if image["mimeType"] != expected_mime:
            raise ValueError("source image format does not match approved original")
        if (image["width"], image["height"]) != (item["width"], item["height"]):
            raise ValueError("source image dimensions do not match manifest")
        thumb_bytes = make_thumbnail(original)
        thumbnail = asset_metadata(thumb_bytes, MAX_THUMBNAIL_BYTES)
        files[image["path"]] = original
        files[thumbnail["path"]] = thumb_bytes
        entry = {key: item[key] for key in ("id", "names", "fit", "sourceUrl", "rightsStatus")}
        attribution = ATTRIBUTION
        if item["licenseId"] == CUSTOM_LICENSE_ID:
            attribution = (f"ZipZipPipe (https://www.pixiv.net/users/18604994). "
                           f"Source album: {item['sourceUrl']}; page {item['page']} "
                           f"(p{item['pixivPageIndex']}). Original URL: {item['originalUrl']}. "
                           "作为保存用，方便所有人取用，需要标注作者，不可商用。 "
                           "No endorsement is implied.")
        entry.update(image=image, thumbnail=thumbnail, attribution=attribution,
                     license=license_infos[item["licenseId"]])
        # A changed thumbnail encoder or legal metadata produces a new immutable entry version.
        entry["version"] = item["version"] + "-" + sha256(json_bytes(entry))[:16]
        entries.append(entry)
    catalog = {"schemaVersion": 1, "version": version, "entries": entries}
    if len(json_bytes(catalog)) > MAX_CATALOG_BYTES:
        raise ValueError("catalog exceeds byte limit")
    return catalog, files


def outside_repository(path: Path) -> Path:
    lexical = Path(os.path.abspath(path.expanduser()))
    resolved = lexical.resolve()
    if any(candidate == REPO_ROOT or REPO_ROOT in candidate.parents
           for candidate in (lexical, resolved)):
        raise ValueError("source and output must be outside the repository")
    # Also reject another checkout; input/output must not become tracked artwork elsewhere.
    if any((parent / ".git").exists() for parent in (resolved, *resolved.parents)):
        raise ValueError("source and output must be outside any repository")
    return resolved


def write_payload(output: Path, catalog: dict, files: dict[str, bytes]) -> None:
    """Stage locally and expose a complete new directory; never update an existing one."""
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".gonavi-gallery-", dir=output.parent) as temporary:
        stage = Path(temporary) / "payload"
        stage.mkdir()
        (stage / "assets").mkdir()
        (stage / "licenses").mkdir()
        for relative, data in files.items():
            path = stage / relative
            with path.open("xb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            if path.read_bytes() != data:
                raise ValueError("payload write verification failed")
        # Catalog is always last, even for local preparation. No server operation occurs.
        with (stage / "catalog.json").open("xb") as stream:
            stream.write(json_bytes(catalog))
            stream.flush()
            os.fsync(stream.fileno())
        if output.exists() or output.is_symlink():
            raise ValueError("output already exists; choose a new external directory")
        stage.rename(output)


def prepare(source_dir: Path, source_manifest: Path, output: Path, version: str,
            *, confirm_noncommercial: bool = False) -> dict:
    if not confirm_noncommercial:
        raise ValueError("explicit --confirm-noncommercial is required")
    if not VERSION_PATTERN.fullmatch(version):
        raise ValueError("version must be 1-64 safe ASCII letters, digits, dot, underscore or hyphen")
    output_path = Path(output).expanduser()
    if output_path.is_symlink():
        raise ValueError("output symlink already exists; choose a new external directory")
    output = outside_repository(output_path)
    source = outside_repository(Path(source_dir))
    if output.exists() or output.is_symlink():
        raise ValueError("output already exists; choose a new external directory")
    if not source.is_dir():
        raise ValueError("source-dir must be an existing external directory")
    if source == output or source in output.parents or output in source.parents:
        raise ValueError("source and output must be separate directories")
    manifest = load_manifest(Path(source_manifest))
    catalog, files = build_payload(source, manifest, version)
    write_payload(output, catalog, files)
    return catalog


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path, help="external directory with pinned originals and legal documents")
    parser.add_argument("--source-manifest", required=True, type=Path, help="explicit reviewed source-manifest.json; no custom approval")
    parser.add_argument("--output", required=True, type=Path, help="new external local payload directory (never a remote destination)")
    parser.add_argument("--version", required=True, help="catalog release version, 1-64 safe ASCII characters")
    parser.add_argument("--confirm-noncommercial", action="store_true", help="confirm free noncommercial distribution, no paid benefits/ads/promotion")
    args = parser.parse_args()
    try:
        catalog = prepare(args.source_dir, args.source_manifest, args.output, args.version,
                          confirm_noncommercial=args.confirm_noncommercial)
    except (ValueError, OSError, UnicodeError) as error:
        parser.exit(2, f"Preparation refused: {error}\n")
    print(json.dumps({"prepared": str(args.output.expanduser().resolve()), "uploaded": False,
                      "entries": [entry["id"] for entry in catalog["entries"]],
                      "catalogSha256": sha256(json_bytes(catalog))}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
