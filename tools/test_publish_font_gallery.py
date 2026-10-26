#!/usr/bin/env python3
"""Offline publisher regression tests; synthetic TTFs only, no network calls."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/publish-font-gallery.py"
spec = importlib.util.spec_from_file_location("font_publisher", SCRIPT)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def synthetic_font(path: Path, family: str = "Test Sans", glyph_count: int = 5) -> bytes:
    glyphs = [f"g{index}" for index in range(glyph_count)]
    builder = FontBuilder(1000, isTTF=True)
    order = [".notdef", *glyphs]
    pen_glyphs = {}
    for glyph in order:
        pen = TTGlyphPen(None)
        pen.moveTo((0, 0))
        pen.lineTo((0, 700))
        pen.lineTo((500, 700))
        pen.lineTo((500, 0))
        pen.closePath()
        pen_glyphs[glyph] = pen.glyph()
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap({ord("A") + index: glyph for index, glyph in enumerate(glyphs)})
    builder.setupGlyf(pen_glyphs)
    builder.setupHorizontalMetrics({glyph: (500, 0) for glyph in order})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({"familyName": family, "styleName": "Regular"})
    builder.setupOS2()
    builder.setupPost()
    builder.save(str(path))
    return path.read_bytes()


def batch_entry(**overrides) -> dict:
    entry = {
        "id": "test-sans",
        "kind": "ui",
        "family": "Test Sans",
        "version": "v1",
        "names": {"en-US": "Test Sans", "zh-CN": "Test Sans"},
        "description": "Synthetic test font.",
        "useCase": "Publisher regression tests.",
        "attribution": "Copyright 2026 Test Authors",
        "sourceUrl": "https://example.com/fonts/TestSans.ttf",
        "fontFile": "TestSans.ttf",
        "license": {
            "id": "MIT",
            "name": "MIT License",
            "url": "https://example.com/LICENSE.txt",
            "licenseFile": "TestSans-LICENSE.txt",
            "nonCommercial": False,
        },
    }
    entry.update(overrides)
    return entry


class PublisherTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gonavi-font-publisher-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.orig = self.root / "orig"
        self.orig.mkdir()
        self.out = self.root / "payload"
        self.font = synthetic_font(self.orig / "TestSans.ttf")
        license_text = "Copyright 2026 Test Authors\n\nMIT License\n\nPermission is hereby granted, free of charge.\n"
        (self.orig / "TestSans-LICENSE.txt").write_text(license_text, encoding="utf-8")
        self.preview_text = self.root / "preview.txt"
        self.preview_text.write_text("Aa Bb Cc 0123", encoding="utf-8")

    def prepare(self, entries=None, previous=None, **patches):
        batch = {
            "publicationVersion": "2026-10-22.1",
            "publishedAt": "2026-10-22T16:10:00Z",
            "publicBaseURL": "https://fonts.example.com/gonavi/fonts/v1/",
            "previousCatalogSha256": None,
            "entries": entries if entries is not None else [batch_entry()],
        }
        with patch.object(publisher, "MAX_FONT_BYTES", patches.pop("max_font", publisher.MAX_FONT_BYTES)):
            with patch.object(publisher, "MAX_PREVIEW_BYTES",
                              patches.pop("max_preview", publisher.MAX_PREVIEW_BYTES)):
                return publisher.prepare(self.orig, batch, self.out, previous, self.preview_text)

    def test_small_font_reuses_original_bytes_as_preview(self):
        record = self.prepare()
        catalog = json.loads((self.out / "catalog.json").read_text(encoding="utf-8"))
        entry = catalog["entries"][0]
        self.assertEqual(entry["font"]["sha256"], digest(self.font))
        self.assertEqual(entry["preview"], entry["font"])
        self.assertEqual(record["previewPolicies"], {"test-sans": "reuse-original-bytes"})
        self.assertEqual(record["catalogVersion"], "2026-10-22.1")
        self.assertTrue((self.out / "assets" / f"{digest(self.font)}.ttf").is_file())
        self.assertIn("Preview uses the identical file.", entry["license"]["notice"])
        self.assertIn("Copyright 2026 Test Authors", entry["license"]["notice"])

    def test_family_mismatch_is_rejected(self):
        with self.assertRaisesRegex(publisher.PublishError, "family mismatch"):
            self.prepare(entries=[batch_entry(family="Wrong Sans")])

    def test_oversized_font_is_rejected(self):
        with self.assertRaisesRegex(publisher.PublishError, "outside 1.."):
            self.prepare(max_font=8)

    def test_large_font_builds_name_preserving_subset_preview(self):
        # 200 glyphs keep the font well above half its size after subsetting to one glyph,
        # so a preview bound of font/2 forces the subset path deterministically.
        font = synthetic_font(self.orig / "TestSans.ttf", glyph_count=200)
        with patch.object(publisher, "MAX_PREVIEW_BYTES", len(font) // 2):
            record = self.prepare()
        catalog = json.loads((self.out / "catalog.json").read_text(encoding="utf-8"))
        entry = catalog["entries"][0]
        self.assertNotEqual(entry["preview"]["sha256"], entry["font"]["sha256"])
        self.assertLessEqual(entry["preview"]["sizeBytes"], len(font) // 2)
        self.assertEqual(record["previewPolicies"], {"test-sans": "subset-preview"})
        self.assertTrue(publisher.family_matches("Test Sans", publisher.font_family_names(
            (self.out / "assets" / f"{entry['preview']['sha256']}.ttf").read_bytes())))

    def test_merges_with_previous_catalog_replacing_by_id(self):
        previous = {"schemaVersion": 1, "version": "2026-10-16.1", "entries": [
            {"id": "old-font", "family": "Old", "kind": "mono"},
            {"id": "test-sans", "family": "Test Sans", "kind": "ui"},
        ]}
        record = self.prepare(previous=previous)
        catalog = json.loads((self.out / "catalog.json").read_text(encoding="utf-8"))
        self.assertEqual([entry["id"] for entry in catalog["entries"]], ["old-font", "test-sans"])
        self.assertEqual(catalog["entries"][1]["version"], "v1")
        self.assertEqual(record["fontCount"], 2)

    def test_duplicate_ids_after_merge_are_rejected(self):
        previous = {"schemaVersion": 1, "version": "2026-10-16.1", "entries": [
            {"id": "test-sans", "family": "Test Sans", "kind": "mono"},
        ]}
        with self.assertRaisesRegex(publisher.PublishError, "duplicate entry id"):
            self.prepare(entries=[batch_entry(), batch_entry(id="test-sans", family="Test Sans")],
                         previous=previous)


if __name__ == "__main__":
    unittest.main()
