#!/usr/bin/env python3

import json
import shutil
import sys
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
LEGAL_FILENAMES = ("LICENSE", "NOTICE")


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: package-driver-release-assets.py <drivers-dir> <output-dir>")

    drivers_dir = Path(sys.argv[1]).resolve()
    output_dir = Path(sys.argv[2]).resolve()

    if not drivers_dir.is_dir():
        raise SystemExit(f"drivers dir not found: {drivers_dir}")

    legal_files = [ROOT / filename for filename in LEGAL_FILENAMES]
    missing_legal_files = [path for path in legal_files if not path.is_file()]
    if missing_legal_files:
        missing = ", ".join(str(path) for path in missing_legal_files)
        raise SystemExit(f"legal notice files not found: {missing}")

    out_name = "GoNavi-DriverAgents.zip"
    index_name = "GoNavi-DriverAgents-Index.json"
    manifest_name = "GoNavi-DriverAgents-Manifest.json"

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    out_path = output_dir / out_name
    index_path = output_dir / index_name
    manifest_path = output_dir / manifest_name

    size_index = {}
    standalone_assets = []
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for asset in sorted(drivers_dir.rglob("*")):
            if not asset.is_file():
                continue
            arcname = asset.relative_to(drivers_dir).as_posix()
            if asset.name in size_index:
                raise RuntimeError(f"driver asset name conflict: {asset.name}")
            zf.write(asset, arcname)
            size_index[asset.name] = asset.stat().st_size
            standalone_path = output_dir / asset.name
            if standalone_path.exists():
                raise RuntimeError(f"release asset already exists: {standalone_path}")
            shutil.copy2(asset, standalone_path)
            standalone_assets.append(standalone_path.name)

        for legal_file in legal_files:
            zf.write(legal_file, legal_file.name)
            standalone_path = output_dir / legal_file.name
            if standalone_path.exists():
                raise RuntimeError(f"release asset already exists: {standalone_path}")
            shutil.copy2(legal_file, standalone_path)

    index_path.write_text(
        json.dumps({"assets": size_index}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"created {out_name} size={out_path.stat().st_size} bytes")
    print(f"created {index_name} entries={len(size_index)}")
    print(f"published standalone driver assets={len(standalone_assets)}")
    print(f"bundled legal files={len(legal_files)}")
    print(f"reserved manifest output path: {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
