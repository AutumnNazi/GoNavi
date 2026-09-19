#!/usr/bin/env python3
"""CI-only override for wails.json desktop tags.

Local `wails build` reads build:tags from wails.json (webkit2_41). WebKitGTK 4.0
release jobs must drop that tag so pkg-config still uses webkit2gtk-4.0.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: ci-apply-wails-webkit-tags.py <4.0|4.1|>", file=sys.stderr)
        return 2
    webkit = sys.argv[1].strip()
    if webkit != "4.0":
        return 0
    path = Path("wails.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    data["build:tags"] = ""
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("cleared wails.json build:tags for WebKitGTK 4.0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
