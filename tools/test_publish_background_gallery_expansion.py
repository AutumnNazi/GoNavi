#!/usr/bin/env python3
"""Offline five-original policy regressions using generated pixels only."""
from __future__ import annotations

import copy
import io
import unittest
from unittest.mock import patch

from PIL import Image

import test_publish_background_gallery as base
from test_publish_background_gallery import digest, publisher, synthetic_jpeg, synthetic_webp

QUOTE = "作为保存用，方便所有人取用，需要标注作者，不可商用。"
CUSTOM_ID = "LicenseRef-ZipZipPipe-Attribution-NonCommercial"
ALBUM = "https://www.pixiv.net/artworks/148186519"
ORIGINAL_BASE = "https://i.pximg.net/img-original/img/2026/08/09/01/18/27/148186519_"


class ExpansionTest(unittest.TestCase):
    setUp = base.PublisherTest.setUp
    pin_fixture = base.PublisherTest.pin_fixture
    prepare = base.PublisherTest.prepare

    def replace_original(self, index, data, size=(36, 48)):
        entry = self.policy["entries"][index]
        (self.source / entry["file"]).write_bytes(data)
        entry.update(sha256=digest(data), sizeBytes=len(data), width=size[0], height=size[1])
        self.pin_fixture()

    def test_whale_entries_match_pre_expansion_synthetic_baseline(self):
        # Captured before this expansion with the required bundled Pillow runtime.
        expected = [
            ("1-d78e92449b526ed6", "cb31f57e43aedff4d28c988ccc7706b2e9cac022e0a66123bab135e914e2a81d"),
            ("1-cadda40115ecabb1", "7f1748738b15da6ec91f70b73c83267c234df60f69b3e87b47b027b50fc8bad9"),
        ]
        for entry, (version, fingerprint) in zip(self.prepare()["entries"][:2], expected):
            self.assertEqual(entry["version"], version)
            self.assertEqual(digest(publisher.json_bytes(entry)), fingerprint)
        for name, fingerprint in [
            ("NOTICE", "cb8764d72cfc8a1143288ed17de5b93ee183a5d70f7a95e0f118880b4a0ba4e6"),
            ("LICENSE-ARTWORK", "52de7059eb8d02acd9ad8bb5e3a8d3b3e4f018c9c0826bd676483e54de31345e"),
        ]:
            self.assertEqual(digest((self.source / name).read_bytes()), fingerprint)

    def test_custom_grant_and_per_image_provenance_are_preserved(self):
        for entry, page in zip(self.prepare()["entries"][2:], [7, 12, 16]):
            license_info = entry["license"]
            self.assertEqual(license_info["id"], CUSTOM_ID)
            self.assertEqual(license_info["url"], ALBUM)
            self.assertEqual(entry["sourceUrl"], ALBUM)
            self.assertNotIn("CC", license_info["name"])
            self.assertNotIn("ShareAlike", license_info["name"])
            original_url = ORIGINAL_BASE + f"p{page - 1}.jpg"
            for text in [license_info["notice"], entry["attribution"]]:
                self.assertIn("ZipZipPipe", text)
                self.assertIn(ALBUM, text)
                self.assertIn(original_url, text)
                self.assertIn(f"page {page}" if text == entry["attribution"] else f"page: {page}", text)
                self.assertIn(QUOTE, text)
            self.assertIn(QUOTE, license_info["text"])
            self.assertIn("NOT the author's original", license_info["text"])
            self.assertIn("not additional author license terms", license_info["text"])
            self.assertIn("DeepSeek-only", license_info["text"])
            self.assertNotIn("Small-tailqwq", entry["attribution"])
            self.assertNotIn("上善", entry["attribution"])

    def test_all_five_entries_require_their_exact_license_assignment(self):
        original_policy = copy.deepcopy(self.policy)
        for index in range(5):
            for value in [None, "", "CC-BY-NC-SA-4.0" if index >= 2 else CUSTOM_ID]:
                with self.subTest(index=index, value=value):
                    self.policy = copy.deepcopy(original_policy)
                    self.policy["entries"][index]["licenseId"] = value
                    self.pin_fixture()
                    with self.assertRaisesRegex(ValueError, "license"):
                        self.prepare()
                    self.assertFalse(self.output.exists())

    def test_wrong_original_url_album_author_or_page_is_rejected(self):
        original_policy = copy.deepcopy(self.policy)
        for index in range(2, 5):
            for key, value in [("originalUrl", ORIGINAL_BASE + "p0.jpg"),
                               ("originalUrl", "https://mirror.invalid/glm-maid-portrait.webp"),
                               ("sourceUrl", "https://www.pixiv.net/artworks/0"),
                               ("author", "another author"), ("page", 1), ("pixivPageIndex", 1)]:
                with self.subTest(index=index, key=key):
                    self.policy = copy.deepcopy(original_policy)
                    self.policy["entries"][index][key] = value
                    self.pin_fixture()
                    with self.assertRaisesRegex(ValueError, "allowlist"):
                        self.prepare()
                    self.assertFalse(self.output.exists())

    def test_mirror_and_pending_assets_cannot_replace_approved_entries(self):
        original_policy = copy.deepcopy(self.policy)
        for filename in ["glm-maid-portrait.webp", "jev.jpg", "hunyuan.jpg", "glm-wallpaper.jpg"]:
            with self.subTest(filename=filename):
                self.policy = copy.deepcopy(original_policy)
                data = synthetic_webp() if filename.endswith("webp") else synthetic_jpeg()
                (self.source / filename).write_bytes(data)
                entry = self.policy["entries"][2]
                entry.update(file=filename, sha256=digest(data), sizeBytes=len(data))
                self.pin_fixture()
                with self.assertRaisesRegex(ValueError, "allowlist"):
                    self.prepare()
                self.assertFalse(self.output.exists())
        self.policy = original_policy
        self.pin_fixture()
        self.assertEqual(len(self.prepare()["entries"]), 5)

    def test_pending_status_on_every_original_rejected(self):
        for index in range(5):
            self.policy["entries"][index]["rightsStatus"] = "pending"
            self.pin_fixture()
            with self.assertRaisesRegex(ValueError, "approved"):
                self.prepare()
            self.policy["entries"][index]["rightsStatus"] = "approved"
        self.assertFalse(self.output.exists())

    def test_jpeg_raw_dimensions_and_original_exif_bytes_are_unchanged(self):
        original = Image.new("RGB", (36, 48), (41, 91, 121))
        exif = Image.Exif()
        exif[274] = 6
        data = io.BytesIO()
        original.save(data, format="JPEG", exif=exif)
        self.replace_original(2, data.getvalue())
        entry = self.prepare()["entries"][2]
        self.assertEqual((entry["image"]["width"], entry["image"]["height"]), (36, 48))
        self.assertEqual((entry["thumbnail"]["width"], entry["thumbnail"]["height"]), (36, 48))
        self.assertEqual((self.output / entry["image"]["path"]).read_bytes(), data.getvalue())

    def test_jpeg_manifest_dimensions_must_match_raw_dimensions(self):
        self.replace_original(2, synthetic_jpeg(), (48, 36))
        with self.assertRaisesRegex(ValueError, "dimensions"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_corrupt_unsupported_animated_and_oversized_jpeg_payloads_fail(self):
        png = io.BytesIO()
        Image.new("RGB", (36, 48)).save(png, format="PNG")
        animation = io.BytesIO()
        Image.new("RGB", (36, 48), "red").save(
            animation, format="WEBP", save_all=True,
            append_images=[Image.new("RGB", (36, 48), "blue")], duration=100, loop=0)
        for data in [b"not a JPEG", synthetic_jpeg()[:-64], png.getvalue(), animation.getvalue(),
                     b"x" * (16 * 1024 * 1024 + 1)]:
            with self.subTest(length=len(data)):
                self.replace_original(2, data)
                with self.assertRaises(ValueError):
                    self.prepare()
                self.assertFalse(self.output.exists())

    def test_original_above_ten_mib_is_preserved_within_sixteen_mib_budget(self):
        original = synthetic_jpeg()
        comment = b"\xff\xfe" + (65535).to_bytes(2, "big") + b"x" * 65533
        data = original[:2] + comment * 172 + original[2:]
        self.assertGreater(len(data), 10 * 1024 * 1024)
        self.assertLess(len(data), 16 * 1024 * 1024)
        self.replace_original(3, data)
        entry = self.prepare()["entries"][3]
        self.assertEqual((self.output / entry["image"]["path"]).read_bytes(), data)

    def test_jpeg_raw_pixel_bomb_rejected_before_load(self):
        data = bytearray(synthetic_jpeg())
        start = data.index(b"\xff\xc0")
        data[start + 5:start + 9] = (5000).to_bytes(2, "big") + (5000).to_bytes(2, "big")
        self.replace_original(2, bytes(data))
        with self.assertRaisesRegex(ValueError, "pixel limit"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_custom_notice_cannot_exceed_catalog_legal_text_limit(self):
        data = b"x" * (16 * 1024 + 1)
        (self.source / "NOTICE-ZIPZIPPIPE").write_bytes(data)
        document = next(item for item in self.policy["documents"]
                        if item["file"] == "NOTICE-ZIPZIPPIPE")
        document.update(sha256=digest(data), sizeBytes=len(data))
        self.pin_fixture()
        with self.assertRaisesRegex(ValueError, "legal text"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_preparation_does_not_open_network_connections(self):
        with patch("socket.create_connection", side_effect=AssertionError("network forbidden")):
            self.assertEqual(len(self.prepare()["entries"]), 5)


if __name__ == "__main__":
    unittest.main()
