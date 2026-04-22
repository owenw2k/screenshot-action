#!/usr/bin/env python3
"""
Download main-branch baseline screenshots from the screenshots branch and compare
with current captures. For each changed screenshot, copies both the baseline
({name}-before.png) and the current ({name}-after.png) to pr-screenshots-changed/
so the PR description can render a before/after comparison.

The {name}-before / {name}-after naming convention is a contract with
upload-screenshots.py, which pairs files by that suffix to build the markdown table.

Required env vars: GITHUB_TOKEN, REPO
Input:  pr-screenshots/*.png  (e.g. hero-light.png, hero-dark.png)
Output: pr-screenshots-changed/{name}-before.png + {name}-after.png for each change,
        or {name}-after.png only for new sections with no baseline.
"""

import base64
import io
import json
import os
import shutil
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops

# Per-channel pixel difference to ignore (absorbs minor anti-aliasing variance).
_TOLERANCE = 5
# Fraction of pixels that must differ beyond tolerance to count as changed.
_THRESHOLD = 0.001


def fetch_baseline(repo: str, filename: str) -> dict:
    """
    Fetch a baseline PNG from the screenshots branch via the GitHub Contents API.

    Baselines live at main/{filename} on the screenshots branch, written by
    store-baselines.py on every push to main.

    @param repo - GitHub repository in owner/repo format
    @param filename - PNG filename, e.g. "hero-light.png"
    @returns Parsed API response with a "content" key (base64 PNG), or {} if not found
    @throws urllib.error.HTTPError for non-404 errors
    """
    token = os.environ["GITHUB_TOKEN"]
    path = f"repos/{repo}/contents/main/{filename}?ref=screenshots"
    url = f"https://api.github.com/{path}"
    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {}
        body = e.read().decode("utf-8", errors="replace")
        print(f"GitHub API error {e.code} fetching baseline {filename}: {body}", file=sys.stderr)
        raise


def images_differ(current: Path, baseline_bytes: bytes) -> bool:
    """
    Return True if the current screenshot differs meaningfully from the baseline.

    Uses Pillow's ImageChops.difference to compute a per-pixel delta image, then
    counts pixels where any RGB channel exceeds _TOLERANCE. If that count exceeds
    _THRESHOLD fraction of total pixels, the images are considered changed.

    The tolerance absorbs sub-pixel anti-aliasing variance that produces false
    positives on otherwise identical renders.

    @param current - Path to the newly captured PNG
    @param baseline_bytes - Raw bytes of the baseline PNG from the screenshots branch
    @returns True if the images are visually different
    """
    img_current = Image.open(current).convert("RGB")
    img_baseline = Image.open(io.BytesIO(baseline_bytes)).convert("RGB")

    if img_current.size != img_baseline.size:
        return True

    diff = ImageChops.difference(img_current, img_baseline)
    total = img_current.width * img_current.height
    changed = sum(
        1
        for r, g, b in diff.getdata()
        if r > _TOLERANCE or g > _TOLERANCE or b > _TOLERANCE
    )
    return (changed / total) > _THRESHOLD


def main() -> None:
    """
    Compare each captured screenshot against its main-branch baseline and copy
    only changed or new screenshots to pr-screenshots-changed/.

    For a changed screenshot named hero-light.png, produces:
      pr-screenshots-changed/hero-light-before.png  (baseline)
      pr-screenshots-changed/hero-light-after.png   (current)

    For a new screenshot with no baseline (first PR to introduce a section),
    produces only the -after.png so the PR still shows it without a broken before.
    """
    repo = os.environ["REPO"]
    src = Path("pr-screenshots")
    out = Path("pr-screenshots-changed")
    out.mkdir(exist_ok=True)

    for img in sorted(src.glob("*.png")):
        name = img.stem  # e.g. "hero-light"
        data = fetch_baseline(repo, img.name)

        if not data or "content" not in data:
            # No baseline yet — treat as new, include after only.
            print(f"  new:     {img.name}", file=sys.stderr)
            shutil.copy(img, out / f"{name}-after.png")
            continue

        baseline_bytes = base64.b64decode(data["content"])
        if images_differ(img, baseline_bytes):
            print(f"  changed: {img.name}", file=sys.stderr)
            (out / f"{name}-before.png").write_bytes(baseline_bytes)
            shutil.copy(img, out / f"{name}-after.png")
        else:
            print(f"  same:    {img.name}", file=sys.stderr)

    changed_count = len(list(out.glob("*-after.png")))
    print(f"{changed_count} screenshot(s) changed.", file=sys.stderr)


main()
