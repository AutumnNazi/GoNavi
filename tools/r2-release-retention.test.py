#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tools" / "r2-release-retention.py"
SPEC = importlib.util.spec_from_file_location("r2_release_retention", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class R2ReleaseRetentionTest(unittest.TestCase):
    def test_selects_only_obsolete_keys_inside_the_requested_release_root(self) -> None:
        keys = [
            "gonavi/releases/download/v0.8.6/GoNavi.exe",
            "gonavi/releases/download/v0.8.7/GoNavi.exe",
            "gonavi/releases/latest/latest.json",
            "gonavi/dev/releases/download/dev-abc/GoNavi.exe",
        ]

        self.assertEqual(
            MODULE.select_obsolete_keys(
                keys,
                "gonavi/releases/download/",
                "gonavi/releases/download/v0.8.7/",
            ),
            ["gonavi/releases/download/v0.8.6/GoNavi.exe"],
        )

    def test_rejects_bucket_wide_or_unknown_prune_roots(self) -> None:
        for root in ("", "/", "gonavi/", "unrelated/releases/download/"):
            with self.subTest(root=root):
                with self.assertRaises(ValueError):
                    MODULE.validate_prune_scope(root, "gonavi/releases/download/v0.8.7/")

    def test_rejects_keep_prefix_outside_or_equal_to_root(self) -> None:
        root = "drivers/dev/releases/download/"
        for keep in (root, "drivers/releases/download/v0.8.7/"):
            with self.subTest(keep=keep):
                with self.assertRaises(ValueError):
                    MODULE.validate_prune_scope(root, keep)

    def test_chunks_deletes_at_most_one_thousand_objects_per_request(self) -> None:
        values = [f"key-{index}" for index in range(2001)]
        batches = list(MODULE.chunks(values))

        self.assertEqual([len(batch) for batch in batches], [1000, 1000, 1])
        self.assertEqual([item for batch in batches for item in batch], values)

    def test_projected_usage_replaces_the_current_channel_before_adding_candidate(self) -> None:
        objects = {
            "gonavi/releases/download/v0.8.7/app.exe": 250,
            "drivers/releases/download/v0.8.7/driver.exe": 3_500,
            "gonavi/dev/releases/download/dev-old/app.exe": 300,
            "drivers/dev/releases/download/dev-old/driver.exe": 3_600,
        }

        retained = MODULE.calculate_retained_bytes(
            objects,
            [
                "gonavi/dev/releases/download/",
                "drivers/dev/releases/download/",
            ],
            add_bytes=4_000,
        )

        self.assertEqual(retained, 7_750)

    def test_validates_stable_driver_pointer_before_pruning(self) -> None:
        asset_name = "sqlserver-driver-agent-windows-amd64.exe"
        pointer = {"tagName": "v0.8.7", "assets": {asset_name: 123}}
        prefix = "drivers/releases/download/v0.8.7/"
        objects = {
            prefix + MODULE.DRIVER_INDEX_NAME: 456,
            prefix + asset_name: 123,
        }

        result = MODULE.validate_driver_pointer_payloads("stable", pointer, pointer, objects)

        self.assertEqual(result["keepPrefix"], prefix)
        self.assertEqual(result["assetCount"], 1)

    def test_rejects_incomplete_driver_pointer_target_before_pruning(self) -> None:
        asset_name = "sqlserver-driver-agent-windows-amd64.exe"
        pointer = {
            "tagName": "dev-latest",
            "mirrorTagName": "dev-a1b2c3d",
            "assets": {asset_name: 123},
        }
        prefix = "drivers/dev/releases/download/dev-a1b2c3d/"
        objects = {prefix + MODULE.DRIVER_INDEX_NAME: 456}

        with self.assertRaisesRegex(ValueError, "missing or has the wrong size"):
            MODULE.validate_driver_pointer_payloads("dev", pointer, pointer, objects)

    def test_workflows_keep_stable_and_dev_roots_isolated(self) -> None:
        stable = (ROOT / ".github" / "workflows" / "publish-release.yml").read_text(encoding="utf-8")
        dev = (ROOT / ".github" / "workflows" / "dev-build.yml").read_text(encoding="utf-8")

        self.assertIn('--root-prefix "gonavi/releases/download/"', stable)
        self.assertIn('--root-prefix "drivers/releases/download/"', stable)
        self.assertNotIn('--root-prefix "gonavi/dev/releases/download/"', stable)
        self.assertIn('validate-driver-pointer', stable)
        self.assertIn('r2-current-stable-driver-state.json', stable)
        self.assertIn('--root-prefix "gonavi/dev/releases/download/"', dev)
        self.assertIn('--root-prefix "drivers/dev/releases/download/"', dev)
        self.assertIn('validate-driver-pointer', dev)
        self.assertIn('r2-current-dev-driver-state.json', dev)

    def test_workflows_exclude_the_duplicate_driver_bundle_and_enforce_budget(self) -> None:
        stable = (ROOT / ".github" / "workflows" / "publish-release.yml").read_text(encoding="utf-8")
        dev = (ROOT / ".github" / "workflows" / "dev-build.yml").read_text(encoding="utf-8")

        self.assertIn(".assets | keys[]", stable)
        self.assertNotIn('.assets["GoNavi-DriverAgents.zip"] =', stable)
        self.assertIn('del(.assets["GoNavi-DriverAgents.zip"])', dev)
        for workflow in (stable, dev):
            self.assertIn("--max-bytes 9000000000", workflow)
            self.assertIn("--exclude-prefix", workflow)
            self.assertIn("--add-bytes", workflow)

    def test_workflows_serialize_stable_and_dev_r2_publication(self) -> None:
        stable = (ROOT / ".github" / "workflows" / "publish-release.yml").read_text(encoding="utf-8")
        dev = (ROOT / ".github" / "workflows" / "dev-build.yml").read_text(encoding="utf-8")

        shared_group = "group: gonavi-r2-publication"
        self.assertEqual(stable.count(shared_group), 1)
        self.assertEqual(dev.count(shared_group), 1)


if __name__ == "__main__":
    unittest.main()
