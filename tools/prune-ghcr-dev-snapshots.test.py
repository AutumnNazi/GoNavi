#!/usr/bin/env python3
"""Tests for the GHCR dev-snapshot pruner selection rules.

The deletion rule is the only thing standing between an operator and a broken
multi-arch image, so every boundary is pinned here explicitly.
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = ROOT / "tools" / "prune-ghcr-dev-snapshots.py"

spec = importlib.util.spec_from_file_location("prune_ghcr_dev_snapshots", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

NOW = 1_800_000_000
DAY = 86400


def version(version_id: int, tags: list[str], age_days: int = 1) -> dict[str, object]:
    return {
        "id": version_id,
        "updated_at": _iso(NOW - age_days * DAY),
        "metadata": {"container": {"tags": tags}},
    }


def _iso(epoch: int) -> str:
    import datetime

    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def select(versions: list[dict[str, object]], min_age_days: int = 0) -> list[dict[str, object]]:
    return module.select_prunable_versions(versions, min_age_days * DAY, now=NOW)


class SelectPrunableVersionsTest(unittest.TestCase):
    def test_deletes_plain_dev_snapshot(self) -> None:
        selected = select([version(1, ["dev-72202fb"])])
        self.assertEqual([entry["id"] for entry in selected], [1])

    def test_keeps_dev_latest_rolling_pointer(self) -> None:
        # The build tagged both dev-latest and its short SHA is still referenced
        # by the rolling pointer; deleting it would break `docker pull dev-latest`.
        selected = select([version(1, ["dev-dff23a6", "dev-latest"])])
        self.assertEqual(selected, [])

    def test_keeps_stable_release_version(self) -> None:
        selected = select([version(1, ["latest", "0.9.8", "0.9"])])
        self.assertEqual(selected, [])

    def test_keeps_minor_floating_tag(self) -> None:
        selected = select([version(1, ["0.9"])])
        self.assertEqual(selected, [])

    def test_keeps_untagged_child_manifest(self) -> None:
        # Multi-arch child manifests carry no tags.  Deleting one breaks the
        # platform index of the parent image.
        selected = select([version(1, [])])
        self.assertEqual(selected, [])

    def test_keeps_version_carrying_dev_and_stable_tags(self) -> None:
        selected = select([version(1, ["dev-72202fb", "0.9"])])
        self.assertEqual(selected, [])

    def test_keeps_non_hex_dev_prefix(self) -> None:
        # `dev-latest` and any future non-SHA dev tag must not match.
        for tag in ("dev-latest", "dev-main", "dev-72202f", "dev-72202fb0", "dev-72202FG"):
            with self.subTest(tag=tag):
                self.assertEqual(select([version(1, [tag])]), [])

    def test_selects_only_plain_snapshots_from_mixed_page(self) -> None:
        versions = [
            version(1, ["dev-dff23a6", "dev-latest"]),
            version(2, ["dev-72202fb"]),
            version(3, []),
            version(4, ["latest", "0.9.8", "0.9"]),
            version(5, ["dev-8fe68ae"]),
            version(6, ["0.9"]),
        ]
        selected = select(versions)
        self.assertEqual([entry["id"] for entry in selected], [2, 5])

    def test_min_age_keeps_recent_snapshots(self) -> None:
        versions = [
            version(1, ["dev-72202fb"], age_days=1),
            version(2, ["dev-8fe68ae"], age_days=30),
        ]
        selected = select(versions, min_age_days=7)
        self.assertEqual([entry["id"] for entry in selected], [2])

    def test_rejects_negative_retention_age(self) -> None:
        with self.assertRaises(ValueError):
            module.select_prunable_versions([version(1, ["dev-72202fb"])], -1, now=NOW)

    def test_rejects_malformed_metadata(self) -> None:
        for payload in (
            {"id": 1, "updated_at": _iso(NOW), "metadata": "broken"},
            {"id": 1, "updated_at": _iso(NOW), "metadata": {"container": []}},
            {"id": 1, "updated_at": _iso(NOW), "metadata": {"container": {"tags": "dev-72202fb"}}},
            {"id": 1, "updated_at": _iso(NOW), "metadata": {"container": {"tags": [1]}}},
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    select([payload])

    def test_rejects_missing_timestamp(self) -> None:
        with self.assertRaises(ValueError):
            select([{"id": 1, "metadata": {"container": {"tags": ["dev-72202fb"]}}}])


class ParseTimestampTest(unittest.TestCase):
    def test_parses_zulu_timestamp(self) -> None:
        self.assertEqual(module.parse_timestamp("2026-09-21T06:33:41Z"), 1789972421)

    def test_parses_offset_timestamp(self) -> None:
        self.assertEqual(
            module.parse_timestamp("2026-09-21T06:33:41+00:00"),
            module.parse_timestamp("2026-09-21T06:33:41Z"),
        )

    def test_rejects_timestamp_without_timezone(self) -> None:
        with self.assertRaises(ValueError):
            module.parse_timestamp("2026-09-21T06:33:41")

    def test_rejects_malformed_timestamp(self) -> None:
        with self.assertRaises(ValueError):
            module.parse_timestamp("not-a-timestamp")


class BuildUrlTest(unittest.TestCase):
    def test_encodes_container_package_path(self) -> None:
        url = module.build_url("https://api.github.com", "syngnat", "gonavi-web-server", 2)
        self.assertEqual(
            url,
            "https://api.github.com/users/syngnat/packages/container/gonavi-web-server"
            "/versions?package_type=container&per_page=100&page=2",
        )


class DockerImagesWorkflowTest(unittest.TestCase):
    """Pin the dev-branch tag policy that keeps version tags discoverable."""

    def setUp(self) -> None:
        self.source = (ROOT / ".github" / "workflows" / "docker-images.yml").read_text(encoding="utf-8")

    def test_dev_branch_publishes_only_rolling_pointer(self) -> None:
        # A permanent dev-<sha> tag per push buries 0.9.8-style version tags far
        # down the package list, which is the whole point of issue #1318.
        self.assertNotIn("type=sha", self.source)
        self.assertNotIn("prefix=dev-", self.source)
        self.assertIn(
            "type=raw,value=dev-latest,enable=${{ github.ref == 'refs/heads/dev' }}",
            self.source,
        )

    def test_stable_release_tags_are_preserved(self) -> None:
        self.assertIn("type=semver,pattern={{version}}", self.source)
        self.assertIn("type=semver,pattern={{major}}.{{minor}}", self.source)
        self.assertIn("type=raw,value=latest", self.source)

    def test_every_published_tag_is_verified_after_push(self) -> None:
        # imagetools create 会算出某个 tag 却没能让它落库，而步骤仍返回 0；
        # 只校验单个 version 的输出会漏掉这种缺口，必须逐个回查 EXPECTED_TAGS。
        self.assertIn("EXPECTED_TAGS: ${{ steps.meta.outputs.tags }}", self.source)
        self.assertIn("Verify every published tag resolves", self.source)
        self.assertIn('imagetools inspect "${tag}"', self.source)
        # 旧的单 tag 校验已被逐个回查取代，不能两个都留着造成假覆盖。
        self.assertNotIn('imagetools inspect "ghcr.io/${{ steps.vars.outputs.owner_lc }}', self.source)


if __name__ == "__main__":
    unittest.main()
