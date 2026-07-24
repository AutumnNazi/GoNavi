#!/usr/bin/env python3

import json
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tools" / "package-driver-release-assets.py"


class PackageDriverReleaseAssetsTest(unittest.TestCase):
    def test_packages_bundle_and_standalone_assets(self):
        with tempfile.TemporaryDirectory(prefix="gonavi-driver-assets-test-") as tmp:
            tmpdir = Path(tmp)
            drivers_dir = tmpdir / "drivers"
            output_dir = tmpdir / "driver-release-assets"
            (drivers_dir / "Windows").mkdir(parents=True)
            (drivers_dir / "MacOS").mkdir(parents=True)

            windows_asset = drivers_dir / "Windows" / "clickhouse-driver-agent-windows-amd64.exe"
            darwin_asset = drivers_dir / "MacOS" / "clickhouse-driver-agent-darwin-arm64"
            windows_asset.write_bytes(b"windows-asset")
            darwin_asset.write_bytes(b"darwin-asset")

            proc = subprocess.run(
                ["python3", str(SCRIPT), str(drivers_dir), str(output_dir)],
                cwd=ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=True,
            )

            self.assertIn("created GoNavi-DriverAgents.zip", proc.stdout)
            self.assertTrue((output_dir / "GoNavi-DriverAgents.zip").is_file())
            self.assertTrue((output_dir / windows_asset.name).is_file())
            self.assertTrue((output_dir / darwin_asset.name).is_file())
            self.assertEqual((output_dir / "LICENSE").read_bytes(), (ROOT / "LICENSE").read_bytes())
            self.assertEqual((output_dir / "NOTICE").read_bytes(), (ROOT / "NOTICE").read_bytes())

            index = json.loads((output_dir / "GoNavi-DriverAgents-Index.json").read_text(encoding="utf-8"))
            self.assertEqual(index["assets"][windows_asset.name], len(b"windows-asset"))
            self.assertEqual(index["assets"][darwin_asset.name], len(b"darwin-asset"))

            with zipfile.ZipFile(output_dir / "GoNavi-DriverAgents.zip") as zf:
                self.assertEqual(
                    sorted(zf.namelist()),
                    [
                        "LICENSE",
                        "MacOS/clickhouse-driver-agent-darwin-arm64",
                        "NOTICE",
                        "Windows/clickhouse-driver-agent-windows-amd64.exe",
                    ],
                )
                self.assertEqual(zf.read("LICENSE"), (ROOT / "LICENSE").read_bytes())
                self.assertEqual(zf.read("NOTICE"), (ROOT / "NOTICE").read_bytes())


if __name__ == "__main__":
    unittest.main()
