#!/usr/bin/env python3
"""Generate a static star-history SVG for README (no third-party token prompts)."""

from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


def gh_api(path: str, accept: str | None = None) -> object:
    cmd = ["gh", "api", path]
    if accept:
        cmd.extend(["-H", f"Accept: {accept}"])
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError(r.stderr or r.stdout or f"gh api failed: {path}")
    return json.loads(r.stdout or "null")


def fetch_star_days(repo: str) -> list[str]:
    days: list[str] = []
    page = 1
    while page <= 80:
        path = f"repos/{repo}/stargazers?per_page=100&page={page}"
        batch = gh_api(path, accept="application/vnd.github.star+json")
        if not isinstance(batch, list) or not batch:
            break
        for item in batch:
            starred_at = item.get("starred_at") if isinstance(item, dict) else None
            if starred_at:
                days.append(str(starred_at)[:10])
        print(f"page {page}: +{len(batch)} total={len(days)}", flush=True)
        if len(batch) < 100:
            break
        page += 1
    return days


def build_svg(
    cum: list[tuple[str, int]],
    title: str = "GoNavi · Star History",
    generated_on: str | None = None,
) -> str:
    width, height = 900, 360
    pad_l, pad_r, pad_t, pad_b = 56, 24, 36, 48
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b
    n = len(cum)
    max_y = max(y for _, y in cum)
    min_y = 0
    stamp = generated_on or ""

    def xy(i: int, y: int) -> tuple[float, float]:
        x = pad_l + (plot_w * i / max(1, n - 1))
        yy = pad_t + plot_h * (1 - (y - min_y) / max(1, max_y - min_y))
        return x, yy

    pts = [xy(i, y) for i, (_, y) in enumerate(cum)]
    poly = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    area = (
        f"M {pts[0][0]:.1f},{pad_t + plot_h:.1f} L "
        + " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        + f" L {pts[-1][0]:.1f},{pad_t + plot_h:.1f} Z"
    )

    subtitle = f"{max_y} stars"
    if stamp:
        subtitle = f"{max_y} stars · updated {stamp}"

    parts: list[str] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-label="GoNavi star history">',
        "  <title>GoNavi Star History</title>",
        "  <defs>",
        '    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">',
        '      <stop offset="0%" stop-color="#8B5CF6" stop-opacity="0.35"/>',
        '      <stop offset="100%" stop-color="#8B5CF6" stop-opacity="0.02"/>',
        "    </linearGradient>",
        "  </defs>",
        '  <rect width="100%" height="100%" fill="#0f172a"/>',
        f'  <text x="{pad_l}" y="24" fill="#e2e8f0" font-family="Segoe UI, system-ui, sans-serif" '
        f'font-size="16" font-weight="600">{title}</text>',
        f'  <text x="{width - pad_r}" y="24" text-anchor="end" fill="#94a3b8" '
        f'font-family="Segoe UI, system-ui, sans-serif" font-size="12">'
        f"{subtitle}</text>",
    ]

    for k in range(5):
        val = int(max_y * k / 4)
        yy = pad_t + plot_h * (1 - k / 4)
        parts.append(
            f'  <line x1="{pad_l}" y1="{yy:.1f}" x2="{width - pad_r}" y2="{yy:.1f}" '
            f'stroke="#334155" stroke-width="1"/>'
        )
        parts.append(
            f'  <text x="{pad_l - 8}" y="{yy + 4:.1f}" text-anchor="end" fill="#94a3b8" '
            f'font-family="Segoe UI, system-ui, sans-serif" font-size="11">{val}</text>'
        )

    parts.append(f'  <path d="{area}" fill="url(#fill)"/>')
    parts.append(
        f'  <polyline fill="none" stroke="#a78bfa" stroke-width="2.5" '
        f'stroke-linejoin="round" stroke-linecap="round" points="{poly}"/>'
    )

    for idx in (0, n // 2, n - 1):
        day, y = cum[idx]
        x, _ = xy(idx, y)
        parts.append(
            f'  <text x="{x:.1f}" y="{height - 16}" text-anchor="middle" fill="#94a3b8" '
            f'font-family="Segoe UI, system-ui, sans-serif" font-size="11">{day}</text>'
        )

    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def main() -> int:
    repo = "Syngnat/GoNavi"
    out = Path(__file__).resolve().parents[1] / "assets" / "star-history.svg"

    days = fetch_star_days(repo)
    if not days:
        print("no star timestamps returned", file=sys.stderr)
        return 1

    by_day = Counter(days)
    ordered = sorted(by_day)
    cum: list[tuple[str, int]] = []
    total = 0
    for day in ordered:
        total += by_day[day]
        cum.append((day, total))

    if len(cum) > 90:
        step = max(1, len(cum) // 80)
        sampled = cum[::step]
        if sampled[-1] != cum[-1]:
            sampled.append(cum[-1])
        cum = sampled

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    svg = build_svg(cum, generated_on=today)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg, encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size} bytes, points={len(cum)}, max={cum[-1][1]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
