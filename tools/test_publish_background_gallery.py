#!/usr/bin/env python3
"""Offline publisher regression tests; synthetic JPEG/WebP only, no network calls."""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import io
import json
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/publish-background-gallery.py"
POLICY = ROOT / "deploy/background-gallery/source-manifest.json"
spec = importlib.util.spec_from_file_location("gallery_publisher", SCRIPT)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def synthetic_webp(size=(30, 48), color=(23, 91, 121, 170)) -> bytes:
    data = io.BytesIO()
    Image.new("RGBA", size, color).save(data, format="WEBP", lossless=True)
    return data.getvalue()


def synthetic_jpeg(size=(36, 48), color=(41, 91, 121)) -> bytes:
    data = io.BytesIO()
    Image.new("RGB", size, color).save(data, format="JPEG", quality=93)
    return data.getvalue()


class PublisherTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gonavi-gallery-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.output = self.root / "payload"
        self.manifest = self.root / "source-manifest.json"
        self.policy = json.loads(POLICY.read_text(encoding="utf-8"))
        for document in self.policy["documents"]:
            data = (ROOT / "deploy/background-gallery" / document["file"]).read_bytes()
            (self.source / document["file"]).write_bytes(data)
        for number, entry in enumerate(self.policy["entries"]):
            data = (synthetic_jpeg((30 + number, 48), (23 + number, 91, 121))
                    if entry["file"].endswith(".jpg") else
                    synthetic_webp((30 + number, 48), (23 + number, 91, 121, 170)))
            (self.source / entry["file"]).write_bytes(data)
            entry.update(sha256=digest(data), sizeBytes=len(data), width=30 + number, height=48)
        self.pin_fixture()

    def pin_fixture(self):
        data = (json.dumps(self.policy, ensure_ascii=False, indent=2) + "\n").encode()
        self.manifest.write_bytes(data)
        self.pin = digest(data)

    def prepare(self, confirm=True, output=None):
        # Only in-process tests substitute synthetic pins; no production CLI override exists.
        with patch.object(publisher, "PINNED_MANIFEST_SHA256", self.pin):
            return publisher.prepare(self.source, self.manifest, output or self.output,
                                     "2026-10-16.1", confirm_noncommercial=confirm)

    def test_correct_exact_catalog_and_original_bytes(self):
        catalog = self.prepare()
        self.assertEqual(set(catalog), {"schemaVersion", "version", "entries"})
        self.assertEqual(catalog["schemaVersion"], 1)
        self.assertEqual(catalog, json.loads((self.output / "catalog.json").read_text()))
        self.assertLessEqual((self.output / "catalog.json").stat().st_size, 2 * 1024 * 1024)
        self.assertEqual([entry["id"] for entry in catalog["entries"]],
                         ["whale-maid-a", "whale-maid-b", "glm-maid-portrait",
                          "wenxin-wheelchair", "minimax-maid"])
        for entry, original in zip(catalog["entries"], self.policy["entries"]):
            self.assertEqual(set(entry), {"id", "version", "names", "fit", "image", "thumbnail",
                                         "attribution", "sourceUrl", "rightsStatus", "license"})
            self.assertEqual(entry["names"], original["names"])
            self.assertEqual(entry["sourceUrl"], original["sourceUrl"])
            self.assertEqual(entry["rightsStatus"], "approved")
            self.assertEqual((self.output / entry["image"]["path"]).read_bytes(),
                             (self.source / original["file"]).read_bytes())
            self.assertEqual(set(entry["license"]),
                             {"id", "name", "url", "notice", "text", "nonCommercial"})
            self.assertTrue(entry["license"]["nonCommercial"])
            whale = entry["id"].startswith("whale-maid-")
            notice_file = "NOTICE" if whale else "NOTICE-ZIPZIPPIPE"
            license_file = "LICENSE-ARTWORK" if whale else "LICENSE-ZIPZIPPIPE"
            self.assertIn((self.source / notice_file).read_text(), entry["license"]["notice"])
            self.assertIn("thumbnail", entry["license"]["notice"].lower())
            self.assertEqual((self.source / license_file).read_text(), entry["license"]["text"])
            for author in (["上善", "ZipZipPipe", "Small-tailqwq"] if whale else ["ZipZipPipe"]):
                self.assertIn(author, entry["attribution"])
            expected_license = ("CC-BY-NC-SA-4.0" if whale else
                                "LicenseRef-ZipZipPipe-Attribution-NonCommercial")
            self.assertEqual(entry["license"]["id"], expected_license)
            for role in ["image", "thumbnail"]:
                asset = entry[role]
                self.assertEqual(set(asset), {"path", "sha256", "sizeBytes", "width", "height", "mimeType"})
                data = (self.output / asset["path"]).read_bytes()
                self.assertEqual(digest(data), asset["sha256"])
                self.assertEqual(len(data), asset["sizeBytes"])
                jpeg = role == "image" and original["file"].endswith(".jpg")
                extension, mime = ("jpg", "image/jpeg") if jpeg else ("webp", "image/webp")
                self.assertEqual(asset["path"], f"assets/{digest(data)}.{extension}")
                self.assertEqual(asset["mimeType"], mime)
                with Image.open(io.BytesIO(data)) as image:
                    self.assertEqual(image.size, (asset["width"], asset["height"]))
            self.assertLessEqual(entry["thumbnail"]["sizeBytes"], 256 * 1024)
        self.assertEqual({p.name for p in self.output.iterdir()}, {"catalog.json", "assets", "licenses"})
        for path in (self.output / "licenses").iterdir():
            self.assertEqual(path.name, digest(path.read_bytes()) + ".txt")

    def test_static_jpeg_metadata_and_proportional_lossless_webp_thumbnail(self):
        data = synthetic_jpeg((600, 900))
        metadata = publisher.asset_metadata(data, 10 * 1024 * 1024)
        self.assertEqual(metadata, {"path": f"assets/{digest(data)}.jpg",
                                   "sha256": digest(data), "sizeBytes": len(data),
                                   "width": 600, "height": 900, "mimeType": "image/jpeg"})
        thumbnail = publisher.make_thumbnail(data)
        self.assertLessEqual(len(thumbnail), 256 * 1024)
        with Image.open(io.BytesIO(data)) as original, Image.open(io.BytesIO(thumbnail)) as result:
            original.thumbnail((512, 512), Image.Resampling.LANCZOS)
            self.assertEqual(result.format, "WEBP")
            self.assertEqual(result.size, original.size)
            self.assertLessEqual(max(result.size), 512)
            self.assertEqual(result.convert("RGB").tobytes(), original.convert("RGB").tobytes())

    def test_explicit_noncommercial_confirmation_required_before_reads(self):
        with patch.object(publisher, "load_manifest", side_effect=AssertionError("must not read")):
            with self.assertRaisesRegex(ValueError, "confirm-noncommercial"):
                self.prepare(confirm=False)
        self.assertFalse(self.output.exists())

    def test_cli_requires_noncommercial_confirmation(self):
        result = subprocess.run([sys.executable, "-B", str(SCRIPT), "--source-dir", str(self.source),
                                 "--source-manifest", str(POLICY), "--output", str(self.output),
                                 "--version", "test-1"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("confirm-noncommercial", result.stderr)
        self.assertFalse(self.output.exists())

    def test_unpinned_manifest_rejected(self):
        with self.assertRaisesRegex(ValueError, "manifest.*pin"):
            publisher.prepare(self.source, self.manifest, self.output, "v1", confirm_noncommercial=True)
        self.assertFalse(self.output.exists())

    def test_corrupt_original_fails_without_output(self):
        path = self.source / "maid-left.webp"
        path.write_bytes(path.read_bytes() + b"corrupt")
        with self.assertRaisesRegex(ValueError, "integrity"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_corrupt_notice_and_license_fail_closed(self):
        for name in [document["file"] for document in self.policy["documents"]]:
            with self.subTest(name=name):
                path = self.source / name
                data = path.read_bytes()
                path.write_bytes(b"CC BY-NC-SA 4.0 incomplete")
                with self.assertRaisesRegex(ValueError, "integrity"):
                    self.prepare()
                self.assertFalse(self.output.exists())
                path.write_bytes(data)

    def test_repository_output_and_symlink_alias_rejected(self):
        paths = [ROOT, ROOT / "gallery-must-not-be-created"]
        alias = self.root / "repo-alias"
        alias.symlink_to(ROOT, target_is_directory=True)
        paths.append(alias / "gallery-must-not-be-created")
        for path in paths:
            with self.subTest(path=path):
                with self.assertRaisesRegex(ValueError, "outside.*repository"):
                    self.prepare(output=path)
        self.assertFalse((ROOT / "gallery-must-not-be-created").exists())

    def test_lexical_repository_path_rejected_even_if_symlink_points_outside(self):
        fake_repo = self.root / "repo"
        fake_repo.mkdir()
        external = self.root / "external"
        external.mkdir()
        (fake_repo / "link-out").symlink_to(external, target_is_directory=True)
        with patch.object(publisher, "REPO_ROOT", fake_repo):
            with self.assertRaisesRegex(ValueError, "outside.*repository"):
                self.prepare(output=fake_repo / "link-out" / "payload")
        self.assertFalse((external / "payload").exists())

    def test_existing_payload_never_overwritten(self):
        self.prepare()
        before = (self.output / "catalog.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "exist"):
            self.prepare()
        self.assertEqual(before, (self.output / "catalog.json").read_bytes())

    def test_dangling_output_symlink_never_followed(self):
        target = self.root / "unexpected-target"
        self.output.symlink_to(target, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "exist|symlink"):
            self.prepare()
        self.assertFalse(target.exists())

    def test_repository_source_rejected(self):
        with self.assertRaisesRegex(ValueError, "outside.*repository"):
            publisher.prepare(ROOT, POLICY, self.output, "v1", confirm_noncommercial=True)
        self.assertFalse(self.output.exists())

    def test_source_symlinks_rejected(self):
        path = self.source / "maid-left.webp"
        data = path.read_bytes()
        path.unlink()
        other = self.root / "linked.webp"
        other.write_bytes(data)
        path.symlink_to(other)
        with self.assertRaisesRegex(ValueError, "regular|symlink"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_pending_or_extra_assets_never_read_or_published(self):
        for change in ["pending", "unknown", "duplicate"]:
            with self.subTest(change=change):
                policy = copy.deepcopy(self.policy)
                if change == "pending":
                    self.policy["entries"][0]["rightsStatus"] = "DEFERRED"
                elif change == "unknown":
                    self.policy["entries"][0]["id"] = "hunyuan-maid"
                else:
                    self.policy["entries"].append(copy.deepcopy(self.policy["entries"][0]))
                self.pin_fixture()
                with patch.object(publisher, "read_verified", side_effect=AssertionError("must not read assets")):
                    with self.assertRaisesRegex(ValueError, "approved|allowlist"):
                        self.prepare()
                self.assertFalse(self.output.exists())
                self.policy = policy

    def test_unused_pending_file_is_ignored(self):
        # No pending source URL or local file may be traversed by the publisher.
        (self.source / "glm-maid-portrait.webp").symlink_to(self.root / "does-not-exist")
        self.assertEqual(len(self.prepare()["entries"]), 5)

    def test_decoded_format_must_match_each_exact_original(self):
        for index, replacement in [(0, synthetic_jpeg()), (2, synthetic_webp())]:
            with self.subTest(index=index):
                entry = self.policy["entries"][index]
                path = self.source / entry["file"]
                before = path.read_bytes()
                previous = dict(entry)
                path.write_bytes(replacement)
                entry.update(sha256=digest(replacement), sizeBytes=len(replacement),
                             width=36 if index == 0 else 30, height=48)
                self.pin_fixture()
                with self.assertRaisesRegex(ValueError, "format"):
                    self.prepare(output=self.root / f"wrong-format-{index}")
                path.write_bytes(before)
                entry.update(previous)

    def test_non_webp_animated_oversized_and_wrong_dimensions_rejected(self):
        png = io.BytesIO()
        Image.new("RGB", (30, 48)).save(png, format="PNG")
        animated = io.BytesIO()
        Image.new("RGBA", (30, 48), "red").save(
            animated, format="WEBP", save_all=True,
            append_images=[Image.new("RGBA", (30, 48), "blue")], duration=100, loop=0)
        for data, size in [(png.getvalue(), (30, 48)), (animated.getvalue(), (30, 48)),
                           (b"x" * (16 * 1024 * 1024 + 1), (30, 48)),
                           (synthetic_webp(), (31, 48)), (synthetic_webp(), (5000, 5000))]:
            with self.subTest(size=size, data_size=len(data)):
                entry = self.policy["entries"][0]
                (self.source / entry["file"]).write_bytes(data)
                entry.update(sha256=digest(data), sizeBytes=len(data), width=size[0], height=size[1])
                self.pin_fixture()
                with self.assertRaises(ValueError):
                    self.prepare()
                self.assertFalse(self.output.exists())

    def test_thumbnail_is_bounded_and_preserves_aspect_alpha(self):
        image = Image.effect_noise((1200, 1800), 80).convert("RGBA")
        image.putalpha(130)
        data = io.BytesIO()
        image.save(data, format="WEBP", lossless=True)
        thumbnail = publisher.make_thumbnail(data.getvalue())
        self.assertLessEqual(len(thumbnail), 256 * 1024)
        with Image.open(io.BytesIO(thumbnail)) as result:
            self.assertLessEqual(max(result.size), 512)
            self.assertAlmostEqual(result.width / result.height, 2 / 3, delta=0.005)
            self.assertEqual(result.mode, "RGBA")

    def test_invalid_catalog_version_rejected(self):
        for version in ["", "../bad", "x" * 65, "v1?bad"]:
            with self.assertRaises(ValueError):
                publisher.prepare(self.source, POLICY, self.output, version, confirm_noncommercial=True)
        self.assertFalse(self.output.exists())

    def test_checked_in_manifest_and_legal_documents_match_pins(self):
        self.assertEqual(digest(POLICY.read_bytes()), publisher.PINNED_MANIFEST_SHA256)
        policy = json.loads(POLICY.read_text())
        for document in policy["documents"]:
            data = (ROOT / "deploy/background-gallery" / document["file"]).read_bytes()
            self.assertEqual(digest(data), document["sha256"])
            self.assertEqual(len(data), document["sizeBytes"])


class NginxGalleryTest(unittest.TestCase):
    def test_standalone_snippet_matches_embedded_block(self):
        snippet = (ROOT / "deploy/background-gallery/bero-locations.conf").read_text()
        config = (ROOT / "deploy/download-mirror/bero-origin-download.conf").read_text()
        block = config.split("    # BEGIN background-gallery v1 (kept in sync with the standalone snippet)\n", 1)[1]
        block = block.split("    # END background-gallery v1", 1)[0]
        unindented = "\n".join(line[4:] if line.startswith("    ") else line for line in block.split("\n"))
        self.assertEqual(snippet, unindented)
        self.assertIn("location = /gonavi/backgrounds/v1/catalog.json", snippet)
        self.assertEqual(snippet.count("limit_except GET { deny all; }"), 3)
        self.assertEqual(snippet.count('Access-Control-Allow-Origin "*" always'), 3)
        self.assertEqual(snippet.count('Access-Control-Allow-Methods "GET, HEAD" always'), 3)
        self.assertNotIn("Access-Control-Allow-Credentials", snippet)
        self.assertEqual(snippet.count("disable_symlinks on"), 3)
        self.assertIn('no-cache, max-age=0, must-revalidate', snippet)
        self.assertNotIn('max-age=31536000, immutable" always', snippet)
        self.assertIn('types { image/webp webp; image/jpeg jpg; }', snippet)
        self.assertIn('types { text/plain txt; }', snippet)
        self.assertNotIn("location ^~", snippet)
        self.assertNotIn("listen", snippet)
        self.assertNotIn("ssl_certificate", snippet)
        self.assertNotIn("proxy_pass", snippet)

    def test_nginx_asset_and_license_regexes_are_exact(self):
        snippet = (ROOT / "deploy/background-gallery/bero-locations.conf").read_text()
        patterns = re.findall(r'location ~ "([^"\n]+)"', snippet)
        self.assertEqual(len(patterns), 2)
        for folder, extension in [("assets", "webp"), ("assets", "jpg"), ("licenses", "txt")]:
            valid = f"/gonavi/backgrounds/v1/{folder}/{'a' * 64}.{extension}"
            self.assertEqual(sum(bool(re.fullmatch(pattern, valid)) for pattern in patterns), 1)
            invalid = [valid + "/", valid + ".html", valid.replace("a" * 64, "a" * 63),
                       valid.replace("a" * 64, "A" * 64), valid.replace("." + extension, "X" + extension),
                       valid.replace("/v1/", "/v2/"), valid.replace("." + extension, ".svg"),
                       *[valid.replace("." + extension, suffix) for suffix in
                         [".jpeg", ".JPG", ".WEBP", ".png", ".gif", ".avif"]]]
            for path in invalid:
                self.assertFalse(any(re.fullmatch(pattern, path) for pattern in patterns), path)

    @unittest.skipUnless(shutil.which("nginx"), "nginx is optional locally; Lead must run live nginx -t")
    def test_standalone_nginx_syntax_without_server_or_certificates(self):
        with tempfile.TemporaryDirectory(prefix="gonavi-nginx-test-") as temporary:
            root = Path(temporary)
            (root / "logs").mkdir()
            config = root / "nginx.conf"
            snippet = ROOT / "deploy/background-gallery/bero-locations.conf"
            config.write_text(
                f'error_log stderr; pid "{root}/nginx.pid"; events {{}}\n'
                f'http {{ access_log off; server {{ listen 127.0.0.1:18443; '
                f'root "{root}"; autoindex off; include "{snippet}"; }} }}\n')
            result = subprocess.run([shutil.which("nginx"), "-t", "-p", str(root), "-c", str(config)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
