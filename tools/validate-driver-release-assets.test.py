#!/usr/bin/env python3

import contextlib
import hashlib
import importlib.util
import io
import json
import pathlib
import sys
import tempfile
import unittest
import zipfile


MODULE_PATH = pathlib.Path(__file__).with_name("validate-driver-release-assets.py")
SPEC = importlib.util.spec_from_file_location("validate_driver_release_assets", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class ValidateDriverReleaseAssetsTests(unittest.TestCase):
    def test_infer_asset_path(self):
        self.assertEqual(
            MODULE.infer_asset_path("clickhouse-driver-agent-darwin-arm64"),
            "MacOS/clickhouse-driver-agent-darwin-arm64",
        )
        self.assertEqual(
            MODULE.infer_asset_path("clickhouse-driver-agent-windows-arm64.exe"),
            "Windows/clickhouse-driver-agent-windows-arm64.exe",
        )
        self.assertEqual(
            MODULE.infer_asset_path("mongodb-driver-agent-v1-windows-amd64.exe"),
            "Windows/mongodb-driver-agent-v1-windows-amd64.exe",
        )
        self.assertEqual(
            MODULE.infer_asset_path("mongodb-driver-agent-v2-darwin-arm64"),
            "MacOS/mongodb-driver-agent-v2-darwin-arm64",
        )
        self.assertEqual(
            MODULE.infer_asset_path("clickhouse-driver-agent-linux-arm64"),
            "Linux/clickhouse-driver-agent-linux-arm64",
        )
        self.assertEqual(MODULE.infer_asset_path("duckdb.dll"), "Windows/duckdb.dll")
        self.assertIsNone(MODULE.infer_asset_path("duckdb-driver.zip"))

    def test_infer_driver_zip_asset_name(self):
        self.assertEqual(
            MODULE.infer_driver_zip_asset_name("clickhouse-driver-agent-darwin-arm64"),
            "clickhouse-driver-agent-darwin-arm64.zip",
        )
        self.assertEqual(
            MODULE.infer_driver_zip_asset_name("mariadb-driver-agent-windows-amd64.exe"),
            "mariadb-driver-agent-windows-amd64.zip",
        )
        self.assertEqual(
            MODULE.infer_driver_zip_asset_name("mongodb-driver-agent-v1-windows-arm64.exe"),
            "mongodb-driver-agent-v1-windows-arm64.zip",
        )
        self.assertEqual(
            MODULE.infer_driver_zip_asset_name("duckdb-driver-agent-windows-amd64.exe"),
            "duckdb-driver-agent-windows-amd64.zip",
        )
        self.assertIsNone(MODULE.infer_driver_zip_asset_name("duckdb.dll"))

    def test_validate_release_assets_extracts_independent_zip(self):
        name = "clickhouse-driver-agent-darwin-arm64"
        zip_name = f"{name}.zip"
        payload = b"zipped-driver-agent"
        release = {
            "assets": [
                {
                    "name": zip_name,
                    "browser_download_url": f"https://example.test/{zip_name}",
                }
            ]
        }
        manifest = {
            "assets": {
                name: {
                    "platform": "darwin/arm64",
                    "revision": "src-expected",
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            }
        }

        with tempfile.TemporaryDirectory(prefix="gonavi-validate-release-assets-") as tmp:
            archive_path = pathlib.Path(tmp) / zip_name
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(f"MacOS/{name}", payload)
            archive_bytes = archive_path.read_bytes()
            archive_sha = hashlib.sha256(archive_bytes).hexdigest()
            release["assets"][0]["size"] = len(archive_bytes)
            release["assets"][0]["digest"] = f"sha256:{archive_sha}"
            manifest["assets"][name]["size"] = len(payload)
            release_index = {
                "assets": {zip_name: len(archive_bytes)},
                "assetSha256": {zip_name: archive_sha},
                "entries": {
                    name: {
                        "archive": zip_name,
                        "path": f"MacOS/{name}",
                        "size": len(payload),
                        "sha256": hashlib.sha256(payload).hexdigest(),
                    }
                },
            }

            downloaded_urls = []
            probed_payloads = []

            def fake_download(url, destination):
                downloaded_urls.append(url)
                destination.write_bytes(archive_path.read_bytes())

            def fake_probe(path):
                probed_payloads.append(path.read_bytes())
                return "src-expected"

            original_download = MODULE.download_url
            original_probe = MODULE.probe_metadata_revision
            try:
                MODULE.download_url = fake_download
                MODULE.probe_metadata_revision = fake_probe
                mismatches, skipped = MODULE.validate_release_assets(
                    release,
                    manifest,
                    runtime_platform="darwin/arm64",
                    release_index=release_index,
                )
            finally:
                MODULE.download_url = original_download
                MODULE.probe_metadata_revision = original_probe

        self.assertEqual(mismatches, [])
        self.assertEqual(skipped, [])
        self.assertEqual(downloaded_urls, [f"https://example.test/{zip_name}"])
        self.assertEqual(probed_payloads, [payload])

    def test_indexed_duckdb_archive_verifies_runtime_library_entry(self):
        name = "duckdb-driver-agent-windows-amd64.exe"
        zip_name = "duckdb-driver-agent-windows-amd64.zip"
        agent_payload = b"duckdb-agent"
        library_payload = b"wrong-duckdb-library"
        expected_library_sha = hashlib.sha256(b"expected-duckdb-library").hexdigest()
        manifest = {
            "assets": {
                name: {
                    "platform": "windows/amd64",
                    "revision": "src-expected",
                    "size": len(agent_payload),
                    "sha256": hashlib.sha256(agent_payload).hexdigest(),
                }
            }
        }

        with tempfile.TemporaryDirectory(prefix="gonavi-validate-release-assets-") as tmp:
            archive_path = pathlib.Path(tmp) / zip_name
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(f"Windows/{name}", agent_payload)
                archive.writestr("Windows/duckdb.dll", library_payload)
            archive_bytes = archive_path.read_bytes()
            archive_sha = hashlib.sha256(archive_bytes).hexdigest()
            release = {
                "assets": [
                    {
                        "name": zip_name,
                        "size": len(archive_bytes),
                        "digest": f"sha256:{archive_sha}",
                        "browser_download_url": f"https://example.test/{zip_name}",
                    }
                ]
            }
            release_index = {
                "assets": {zip_name: len(archive_bytes)},
                "assetSha256": {zip_name: archive_sha},
                "entries": {
                    name: {
                        "archive": zip_name,
                        "path": f"Windows/{name}",
                        "size": len(agent_payload),
                        "sha256": hashlib.sha256(agent_payload).hexdigest(),
                    },
                    "duckdb.dll": {
                        "archive": zip_name,
                        "path": "Windows/duckdb.dll",
                        "size": len(library_payload),
                        "sha256": expected_library_sha,
                    },
                },
            }

            def fake_download(_url, destination):
                destination.write_bytes(archive_bytes)

            original_download = MODULE.download_url
            original_probe = MODULE.probe_metadata_revision
            try:
                MODULE.download_url = fake_download
                MODULE.probe_metadata_revision = lambda _path: "src-expected"
                mismatches, skipped = MODULE.validate_release_assets(
                    release,
                    manifest,
                    runtime_platform="windows/amd64",
                    release_index=release_index,
                )
            finally:
                MODULE.download_url = original_download
                MODULE.probe_metadata_revision = original_probe

        self.assertEqual(skipped, [])
        self.assertEqual(
            mismatches,
            [
                (
                    "duckdb.dll",
                    "entry_sha256",
                    hashlib.sha256(library_payload).hexdigest(),
                    expected_library_sha,
                )
            ],
        )

    def test_indexed_validation_rejects_ci_bundle_archive_maps(self):
        name = "clickhouse-driver-agent-linux-amd64"
        zip_name = f"{name}.zip"
        archive_bytes = b"independent-archive"
        archive_sha = hashlib.sha256(archive_bytes).hexdigest()
        bundle_bytes = b"ci-completion-bundle"
        bundle_sha = hashlib.sha256(bundle_bytes).hexdigest()
        payload = b"driver"
        release = {
            "assets": [
                {
                    "name": zip_name,
                    "size": len(archive_bytes),
                    "digest": f"sha256:{archive_sha}",
                    "browser_download_url": f"https://example.test/{zip_name}",
                },
                {
                    "name": MODULE.CI_BUNDLE_ASSET_NAME,
                    "size": len(bundle_bytes),
                    "digest": f"sha256:{bundle_sha}",
                    "browser_download_url": f"https://example.test/{MODULE.CI_BUNDLE_ASSET_NAME}",
                },
            ]
        }
        manifest = {
            "assets": {
                name: {
                    "platform": "linux/amd64",
                    "revision": "src-expected",
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            }
        }
        release_index = {
            "assets": {
                zip_name: len(archive_bytes),
                MODULE.CI_BUNDLE_ASSET_NAME: len(bundle_bytes),
            },
            "assetSha256": {
                zip_name: archive_sha,
                MODULE.CI_BUNDLE_ASSET_NAME: bundle_sha,
            },
            "entries": {
                name: {
                    "archive": zip_name,
                    "path": f"Linux/{name}",
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            },
        }

        def fail_download(_url, _destination):
            raise AssertionError("cross-platform indexed asset should not be downloaded")

        original_download = MODULE.download_url
        try:
            MODULE.download_url = fail_download
            mismatches, skipped = MODULE.validate_release_assets(
                release,
                manifest,
                runtime_platform="darwin/arm64",
                release_index=release_index,
            )
        finally:
            MODULE.download_url = original_download

        self.assertEqual(skipped, [])
        self.assertIn(
            (MODULE.CI_BUNDLE_ASSET_NAME, "index_ci_bundle", "present in assets", "absent"),
            mismatches,
        )
        self.assertIn(
            (
                MODULE.CI_BUNDLE_ASSET_NAME,
                "index_ci_bundle_sha256",
                "present in assetSha256",
                "absent",
            ),
            mismatches,
        )

    def test_indexed_validation_rejects_entry_backed_by_ci_bundle(self):
        name = "clickhouse-driver-agent-linux-amd64"
        zip_name = f"{name}.zip"
        archive_bytes = b"independent-archive"
        archive_sha = hashlib.sha256(archive_bytes).hexdigest()
        payload = b"driver"
        release = {
            "assets": [
                {
                    "name": zip_name,
                    "size": len(archive_bytes),
                    "digest": f"sha256:{archive_sha}",
                    "browser_download_url": f"https://example.test/{zip_name}",
                }
            ]
        }
        manifest = {
            "assets": {
                name: {
                    "platform": "linux/amd64",
                    "revision": "src-expected",
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            }
        }
        release_index = {
            "assets": {zip_name: len(archive_bytes)},
            "assetSha256": {zip_name: archive_sha},
            "entries": {
                name: {
                    "archive": zip_name,
                    "path": f"Linux/{name}",
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                },
                "rogue-driver-agent": {
                    "archive": MODULE.CI_BUNDLE_ASSET_NAME,
                    "path": "Linux/rogue-driver-agent",
                    "size": 1,
                    "sha256": "a" * 64,
                },
            },
        }

        def fail_download(_url, _destination):
            raise AssertionError("cross-platform indexed asset should not be downloaded")

        original_download = MODULE.download_url
        try:
            MODULE.download_url = fail_download
            mismatches, skipped = MODULE.validate_release_assets(
                release,
                manifest,
                runtime_platform="darwin/arm64",
                release_index=release_index,
            )
        finally:
            MODULE.download_url = original_download

        self.assertEqual(skipped, [])
        self.assertIn(
            (
                "rogue-driver-agent",
                "index_ci_bundle_entry",
                MODULE.CI_BUNDLE_ASSET_NAME,
                "individual driver archive",
            ),
            mismatches,
        )

    def test_indexed_validation_rejects_malformed_cross_platform_duckdb_library(self):
        name = MODULE.DUCKDB_WINDOWS_AGENT_NAME
        zip_name = MODULE.infer_driver_zip_asset_name(name)
        archive_bytes = b"duckdb-archive"
        archive_sha = hashlib.sha256(archive_bytes).hexdigest()
        payload = b"duckdb-agent"
        release = {
            "assets": [
                {
                    "name": zip_name,
                    "size": len(archive_bytes),
                    "digest": f"sha256:{archive_sha}",
                    "browser_download_url": f"https://example.test/{zip_name}",
                }
            ]
        }
        manifest = {
            "assets": {
                name: {
                    "platform": "windows/amd64",
                    "revision": "src-expected",
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            }
        }
        release_index = {
            "assets": {zip_name: len(archive_bytes)},
            "assetSha256": {zip_name: archive_sha},
            "entries": {
                name: {
                    "archive": zip_name,
                    "path": f"Windows/{name}",
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                },
                MODULE.DUCKDB_WINDOWS_LIBRARY_NAME: {
                    "archive": "missing.zip",
                    "path": "../Windows/duckdb.dll",
                    "size": -1,
                    "sha256": "invalid",
                },
            },
        }

        def fail_download(_url, _destination):
            raise AssertionError("cross-platform indexed asset should not be downloaded")

        original_download = MODULE.download_url
        try:
            MODULE.download_url = fail_download
            mismatches, skipped = MODULE.validate_release_assets(
                release,
                manifest,
                runtime_platform="darwin/arm64",
                release_index=release_index,
            )
        finally:
            MODULE.download_url = original_download

        self.assertEqual(skipped, [])
        self.assertIn(
            (MODULE.DUCKDB_WINDOWS_LIBRARY_NAME, "index_asset", "missing.zip", "present in assets"),
            mismatches,
        )
        self.assertIn(
            (
                MODULE.DUCKDB_WINDOWS_LIBRARY_NAME,
                "index_entry_path",
                "../Windows/duckdb.dll",
                "safe relative archive path",
            ),
            mismatches,
        )
        self.assertIn(
            (MODULE.DUCKDB_WINDOWS_LIBRARY_NAME, "index_entry_size", -1, "non-negative integer"),
            mismatches,
        )
        self.assertIn(
            (MODULE.DUCKDB_WINDOWS_LIBRARY_NAME, "index_entry_sha256", "invalid", "sha256"),
            mismatches,
        )
        self.assertIn(
            (MODULE.DUCKDB_WINDOWS_LIBRARY_NAME, "index_archive", "missing.zip", zip_name),
            mismatches,
        )

    def test_indexed_validation_requires_duckdb_library_mapping(self):
        name = MODULE.DUCKDB_WINDOWS_AGENT_NAME
        zip_name = MODULE.infer_driver_zip_asset_name(name)
        archive_bytes = b"duckdb-archive"
        archive_sha = hashlib.sha256(archive_bytes).hexdigest()
        payload = b"duckdb-agent"
        release = {
            "assets": [
                {
                    "name": zip_name,
                    "size": len(archive_bytes),
                    "digest": f"sha256:{archive_sha}",
                    "browser_download_url": f"https://example.test/{zip_name}",
                }
            ]
        }
        manifest = {
            "assets": {
                name: {
                    "platform": "windows/amd64",
                    "revision": "src-expected",
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            }
        }
        release_index = {
            "assets": {zip_name: len(archive_bytes)},
            "assetSha256": {zip_name: archive_sha},
            "entries": {
                name: {
                    "archive": zip_name,
                    "path": f"Windows/{name}",
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            },
        }

        def fail_download(_url, _destination):
            raise AssertionError("cross-platform indexed asset should not be downloaded")

        original_download = MODULE.download_url
        try:
            MODULE.download_url = fail_download
            mismatches, skipped = MODULE.validate_release_assets(
                release,
                manifest,
                runtime_platform="darwin/arm64",
                release_index=release_index,
            )
        finally:
            MODULE.download_url = original_download

        self.assertEqual(skipped, [])
        self.assertIn(
            (
                MODULE.DUCKDB_WINDOWS_LIBRARY_NAME,
                "index_entry",
                "",
                f"present with {MODULE.DUCKDB_WINDOWS_AGENT_NAME}",
            ),
            mismatches,
        )

    def test_validate_release_assets_reports_independent_zip_raw_sha_mismatch(self):
        name = "mariadb-driver-agent-windows-amd64.exe"
        zip_name = "mariadb-driver-agent-windows-amd64.zip"
        payload = b"unexpected-driver-agent"
        expected_manifest_sha = "d" * 64
        release = {
            "assets": [
                {
                    "name": zip_name,
                    "browser_download_url": f"https://example.test/{zip_name}",
                    "digest": f"sha256:{hashlib.sha256(b'archive-bytes').hexdigest()}",
                }
            ]
        }
        manifest = {
            "assets": {
                name: {
                    "platform": "windows/amd64",
                    "revision": "src-expected",
                    "sha256": expected_manifest_sha,
                }
            }
        }

        with tempfile.TemporaryDirectory(prefix="gonavi-validate-release-assets-") as tmp:
            archive_path = pathlib.Path(tmp) / zip_name
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(f"Windows/{name}", payload)
            archive_bytes = archive_path.read_bytes()
            archive_sha = hashlib.sha256(archive_bytes).hexdigest()
            release["assets"][0]["size"] = len(archive_bytes)
            release["assets"][0]["digest"] = f"sha256:{archive_sha}"
            manifest["assets"][name]["size"] = len(payload)
            release_index = {
                "assets": {zip_name: len(archive_bytes)},
                "assetSha256": {zip_name: archive_sha},
                "entries": {
                    name: {
                        "archive": zip_name,
                        "path": f"Windows/{name}",
                        "size": len(payload),
                        "sha256": hashlib.sha256(payload).hexdigest(),
                    }
                },
            }

            def fail_download(_url, _destination):
                raise AssertionError("cross-platform indexed asset should not be downloaded")

            original_download = MODULE.download_url
            original_probe = MODULE.probe_metadata_revision
            try:
                MODULE.download_url = fail_download
                MODULE.probe_metadata_revision = lambda _path: "src-expected"
                mismatches, skipped = MODULE.validate_release_assets(
                    release,
                    manifest,
                    runtime_platform="linux/amd64",
                    release_index=release_index,
                )
            finally:
                MODULE.download_url = original_download
                MODULE.probe_metadata_revision = original_probe

        self.assertEqual(skipped, [])
        self.assertEqual(
            mismatches,
            [(name, "index_sha256", hashlib.sha256(payload).hexdigest(), expected_manifest_sha)],
        )

    def test_validate_release_assets_skips_cross_platform_zip_revision_probe(self):
        name = "mongodb-driver-agent-v1-linux-arm64"
        zip_name = f"{name}.zip"
        payload = b"cross-platform-driver-agent"
        release = {
            "assets": [
                {
                    "name": zip_name,
                    "browser_download_url": f"https://example.test/{zip_name}",
                }
            ]
        }
        manifest = {
            "assets": {
                name: {
                    "platform": "linux/arm64",
                    "revision": "src-expected",
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            }
        }

        with tempfile.TemporaryDirectory(prefix="gonavi-validate-release-assets-") as tmp:
            archive_path = pathlib.Path(tmp) / zip_name
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(f"Linux/{name}", payload)
            archive_bytes = archive_path.read_bytes()
            archive_sha = hashlib.sha256(archive_bytes).hexdigest()
            release["assets"][0]["size"] = len(archive_bytes)
            release["assets"][0]["digest"] = f"sha256:{archive_sha}"
            manifest["assets"][name]["size"] = len(payload)
            release_index = {
                "assets": {zip_name: len(archive_bytes)},
                "assetSha256": {zip_name: archive_sha},
                "entries": {
                    name: {
                        "archive": zip_name,
                        "path": f"Linux/{name}",
                        "size": len(payload),
                        "sha256": hashlib.sha256(payload).hexdigest(),
                    }
                },
            }

            def fail_download(_url, _destination):
                raise AssertionError("cross-platform indexed asset should not be downloaded")

            def fail_probe(_path):
                raise AssertionError("cross-platform zip entry should not be executed")

            original_download = MODULE.download_url
            original_probe = MODULE.probe_metadata_revision
            try:
                MODULE.download_url = fail_download
                MODULE.probe_metadata_revision = fail_probe
                mismatches, skipped = MODULE.validate_release_assets(
                    release,
                    manifest,
                    runtime_platform="darwin/arm64",
                    release_index=release_index,
                )
            finally:
                MODULE.download_url = original_download
                MODULE.probe_metadata_revision = original_probe

        self.assertEqual(mismatches, [])
        self.assertEqual(skipped, [])

    def test_validate_release_assets_reports_missing_independent_zip_entry(self):
        name = "clickhouse-driver-agent-linux-amd64"
        zip_name = f"{name}.zip"
        release = {
            "assets": [
                {
                    "name": zip_name,
                    "browser_download_url": f"https://example.test/{zip_name}",
                }
            ]
        }
        manifest = {
            "assets": {
                name: {
                    "platform": "linux/amd64",
                    "revision": "src-expected",
                    "sha256": hashlib.sha256(b"driver").hexdigest(),
                }
            }
        }

        with tempfile.TemporaryDirectory(prefix="gonavi-validate-release-assets-") as tmp:
            archive_path = pathlib.Path(tmp) / zip_name
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(name, b"driver")
            archive_bytes = archive_path.read_bytes()
            archive_sha = hashlib.sha256(archive_bytes).hexdigest()
            release["assets"][0]["size"] = len(archive_bytes)
            release["assets"][0]["digest"] = f"sha256:{archive_sha}"
            manifest["assets"][name]["size"] = len(b"driver")
            release_index = {
                "assets": {zip_name: len(archive_bytes)},
                "assetSha256": {zip_name: archive_sha},
                "entries": {
                    name: {
                        "archive": zip_name,
                        "path": f"Linux/{name}",
                        "size": len(b"driver"),
                        "sha256": hashlib.sha256(b"driver").hexdigest(),
                    }
                },
            }

            def fake_download(_url, destination):
                destination.write_bytes(archive_path.read_bytes())

            original_download = MODULE.download_url
            try:
                MODULE.download_url = fake_download
                mismatches, skipped = MODULE.validate_release_assets(
                    release,
                    manifest,
                    runtime_platform="linux/amd64",
                    release_index=release_index,
                )
            finally:
                MODULE.download_url = original_download

        self.assertEqual(skipped, [])
        self.assertEqual(
            mismatches,
            [(name, "zip_entry", "", f"Linux/{name}")],
        )

    def test_indexed_validation_checks_release_archive_metadata_without_download(self):
        name = "clickhouse-driver-agent-linux-amd64"
        zip_name = f"{name}.zip"
        payload = b"driver"
        expected_archive = b"indexed-archive"
        expected_archive_sha = hashlib.sha256(expected_archive).hexdigest()
        release = {
            "assets": [
                {
                    "name": zip_name,
                    "size": len(expected_archive) + 1,
                    "digest": f"sha256:{hashlib.sha256(b'wrong-archive').hexdigest()}",
                    "browser_download_url": f"https://example.test/{zip_name}",
                }
            ]
        }
        manifest = {
            "assets": {
                name: {
                    "platform": "linux/amd64",
                    "revision": "src-expected",
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            }
        }
        release_index = {
            "assets": {zip_name: len(expected_archive)},
            "assetSha256": {zip_name: expected_archive_sha},
            "entries": {
                name: {
                    "archive": zip_name,
                    "path": f"Linux/{name}",
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            },
        }

        def fail_download(_url, _destination):
            raise AssertionError("cross-platform indexed asset should not be downloaded")

        original_download = MODULE.download_url
        try:
            MODULE.download_url = fail_download
            mismatches, skipped = MODULE.validate_release_assets(
                release,
                manifest,
                runtime_platform="darwin/arm64",
                release_index=release_index,
            )
        finally:
            MODULE.download_url = original_download

        self.assertEqual(skipped, [])
        self.assertEqual(
            mismatches,
            [
                (zip_name, "archive_size", len(expected_archive) + 1, len(expected_archive)),
                (
                    zip_name,
                    "archive_sha256",
                    hashlib.sha256(b"wrong-archive").hexdigest(),
                    expected_archive_sha,
                ),
            ],
        )

    def test_malformed_new_index_does_not_fall_back_to_zip_downloads(self):
        name = "clickhouse-driver-agent-linux-amd64"
        zip_name = f"{name}.zip"
        release = {
            "assets": [
                {
                    "name": zip_name,
                    "browser_download_url": f"https://example.test/{zip_name}",
                }
            ]
        }
        manifest = {
            "assets": {
                name: {
                    "platform": "linux/amd64",
                    "revision": "src-expected",
                    "size": 6,
                    "sha256": hashlib.sha256(b"driver").hexdigest(),
                }
            }
        }
        release_index = {"assets": {zip_name: 123}, "entries": {}}

        def fail_download(_url, _destination):
            raise AssertionError("malformed new index must fail before downloading archives")

        original_download = MODULE.download_url
        try:
            MODULE.download_url = fail_download
            with self.assertRaisesRegex(RuntimeError, "assetSha256"):
                MODULE.validate_release_assets(
                    release,
                    manifest,
                    runtime_platform="linux/amd64",
                    release_index=release_index,
                )
        finally:
            MODULE.download_url = original_download

    def test_main_downloads_index_and_avoids_cross_platform_archive(self):
        name = "mongodb-driver-agent-v1-linux-arm64"
        zip_name = f"{name}.zip"
        payload = b"driver"
        archive_size = 123
        archive_sha = hashlib.sha256(b"archive").hexdigest()
        manifest = {
            "assets": {
                name: {
                    "platform": "linux/arm64",
                    "revision": "src-expected",
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            }
        }
        release_index = {
            "assets": {zip_name: archive_size},
            "assetSha256": {zip_name: archive_sha},
            "entries": {
                name: {
                    "archive": zip_name,
                    "path": f"Linux/{name}",
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            },
        }
        release = {
            "assets": [
                {
                    "name": MODULE.MANIFEST_ASSET_NAME,
                    "browser_download_url": "https://example.test/manifest",
                },
                {
                    "name": MODULE.INDEX_ASSET_NAME,
                    "browser_download_url": "https://example.test/index",
                },
                {
                    "name": zip_name,
                    "size": archive_size,
                    "digest": f"sha256:{archive_sha}",
                    "browser_download_url": f"https://example.test/{zip_name}",
                },
            ]
        }
        downloaded_urls = []

        def fake_download(url, destination):
            downloaded_urls.append(url)
            if url.endswith("/manifest"):
                destination.write_text(json.dumps(manifest), encoding="utf-8")
            elif url.endswith("/index"):
                destination.write_text(json.dumps(release_index), encoding="utf-8")
            else:
                raise AssertionError("main should not download a cross-platform archive")

        original_load_release = MODULE.load_release
        original_download = MODULE.download_url
        original_runtime = MODULE.current_runtime_platform
        original_argv = sys.argv
        try:
            MODULE.load_release = lambda _repo, _tag: release
            MODULE.download_url = fake_download
            MODULE.current_runtime_platform = lambda: "darwin/arm64"
            sys.argv = [str(MODULE_PATH), "--tag", "dev-latest"]
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(MODULE.main(), 0)
        finally:
            MODULE.load_release = original_load_release
            MODULE.download_url = original_download
            MODULE.current_runtime_platform = original_runtime
            sys.argv = original_argv

        self.assertEqual(
            downloaded_urls,
            ["https://example.test/manifest", "https://example.test/index"],
        )

    def test_validate_release_assets_reports_sha_mismatch(self):
        release = {
            "assets": [
                {
                    "name": "clickhouse-driver-agent-darwin-arm64",
                    "browser_download_url": "https://example.test/clickhouse-driver-agent-darwin-arm64",
                }
            ]
        }
        manifest = {
            "assets": {
                "clickhouse-driver-agent-darwin-arm64": {
                    "revision": "src-expected",
                    "sha256": "deadbeef",
                }
            }
        }

        with tempfile.TemporaryDirectory(prefix="gonavi-validate-release-assets-") as tmp:
            payload_path = pathlib.Path(tmp) / "clickhouse-driver-agent-darwin-arm64"
            payload_path.write_bytes(b"test-binary")

            def fake_download(url, destination):
                destination.write_bytes(payload_path.read_bytes())

            original_download = MODULE.download_url
            original_probe = MODULE.probe_metadata_revision
            try:
                MODULE.download_url = fake_download
                MODULE.probe_metadata_revision = lambda _path: "src-expected"
                mismatches, skipped = MODULE.validate_release_assets(release, manifest)
            finally:
                MODULE.download_url = original_download
                MODULE.probe_metadata_revision = original_probe

        self.assertEqual(skipped, [])
        self.assertEqual(len(mismatches), 1)
        name, field, actual, expected = mismatches[0]
        self.assertEqual(name, "clickhouse-driver-agent-darwin-arm64")
        self.assertEqual(field, "sha256")
        self.assertEqual(actual, hashlib.sha256(b"test-binary").hexdigest())
        self.assertEqual(expected, "deadbeef")

    def test_validate_release_assets_reports_revision_mismatch(self):
        release = {
            "assets": [
                {
                    "name": "clickhouse-driver-agent-darwin-arm64",
                    "browser_download_url": "https://example.test/clickhouse-driver-agent-darwin-arm64",
                }
            ]
        }
        payload = b"test-binary"
        manifest = {
            "assets": {
                "clickhouse-driver-agent-darwin-arm64": {
                    "platform": "darwin/arm64",
                    "revision": "src-expected",
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            }
        }

        with tempfile.TemporaryDirectory(prefix="gonavi-validate-release-assets-") as tmp:
            payload_path = pathlib.Path(tmp) / "clickhouse-driver-agent-darwin-arm64"
            payload_path.write_bytes(payload)

            def fake_download(url, destination):
                destination.write_bytes(payload_path.read_bytes())

            original_download = MODULE.download_url
            original_probe = MODULE.probe_metadata_revision
            try:
                MODULE.download_url = fake_download
                MODULE.probe_metadata_revision = lambda _path: "src-actual"
                mismatches, skipped = MODULE.validate_release_assets(release, manifest, runtime_platform="darwin/arm64")
            finally:
                MODULE.download_url = original_download
                MODULE.probe_metadata_revision = original_probe

        self.assertEqual(skipped, [])
        self.assertEqual(mismatches, [("clickhouse-driver-agent-darwin-arm64", "revision", "src-actual", "src-expected")])

    def test_validate_release_assets_skips_cross_platform_revision_probe(self):
        release = {
            "assets": [
                {
                    "name": "clickhouse-driver-agent-darwin-amd64",
                    "browser_download_url": "https://example.test/clickhouse-driver-agent-darwin-amd64",
                }
            ]
        }
        payload = b"darwin-binary"
        manifest = {
            "assets": {
                "clickhouse-driver-agent-darwin-amd64": {
                    "platform": "darwin/amd64",
                    "revision": "src-expected",
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            }
        }

        with tempfile.TemporaryDirectory(prefix="gonavi-validate-release-assets-") as tmp:
            payload_path = pathlib.Path(tmp) / "clickhouse-driver-agent-darwin-amd64"
            payload_path.write_bytes(payload)

            def fake_download(url, destination):
                destination.write_bytes(payload_path.read_bytes())

            def fail_probe(_path):
                raise AssertionError("cross-platform asset should not be executed")

            original_download = MODULE.download_url
            original_probe = MODULE.probe_metadata_revision
            try:
                MODULE.download_url = fake_download
                MODULE.probe_metadata_revision = fail_probe
                mismatches, skipped = MODULE.validate_release_assets(release, manifest, runtime_platform="linux/amd64")
            finally:
                MODULE.download_url = original_download
                MODULE.probe_metadata_revision = original_probe

        self.assertEqual(mismatches, [])
        self.assertEqual(skipped, [])

    def test_validate_release_assets_uses_release_digest_without_download(self):
        payload = b"darwin-binary"
        digest = hashlib.sha256(payload).hexdigest()
        release = {
            "assets": [
                {
                    "name": "clickhouse-driver-agent-darwin-amd64",
                    "digest": f"sha256:{digest}",
                    "browser_download_url": "https://example.test/clickhouse-driver-agent-darwin-amd64",
                }
            ]
        }
        manifest = {
            "assets": {
                "clickhouse-driver-agent-darwin-amd64": {
                    "platform": "darwin/amd64",
                    "revision": "src-expected",
                    "sha256": digest,
                }
            }
        }

        def fail_download(_url, _destination):
            raise AssertionError("release digest should avoid downloading cross-platform assets")

        original_download = MODULE.download_url
        try:
            MODULE.download_url = fail_download
            mismatches, skipped = MODULE.validate_release_assets(release, manifest, runtime_platform="linux/amd64")
        finally:
            MODULE.download_url = original_download

        self.assertEqual(mismatches, [])
        self.assertEqual(skipped, [])


if __name__ == "__main__":
    unittest.main()
