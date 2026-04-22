#!/usr/bin/env python3
"""
Upload screenshots to the screenshots branch via the GitHub API, then print
the markdown image block to stdout for injection into the PR description.

Handles before/after pairs: files named {name}-before.png and {name}-after.png
are rendered as a side-by-side table. Files with only an -after.png (new sections
with no baseline) are rendered as a single image labelled "(new)".

Files are stored at screenshots/{pr_number}-{filename} on the screenshots branch,
namespaced by PR so multiple open PRs don't overwrite each other.

Required env vars: GITHUB_TOKEN, REPO (owner/repo), PR_NUMBER
Optional env var:  SCREENSHOT_DIR (default: pr-screenshots-changed)
"""

import base64
import json
import os
import sys
import urllib.request
from pathlib import Path


def gh_api(method: str, path: str, payload: dict | None = None) -> dict:
    """
    Make a request to the GitHub Contents API.

    @param method - HTTP verb ("GET" or "PUT")
    @param path - API path, e.g. "repos/owner/repo/contents/..."
    @param payload - JSON body for PUT requests
    @returns Parsed JSON response, or {} on 404
    @throws urllib.error.HTTPError for non-404 errors
    """
    token = os.environ["GITHUB_TOKEN"]
    url = f"https://api.github.com/{path}"
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {}
        body = e.read().decode("utf-8", errors="replace")
        print(f"GitHub API error {e.code} on {method} {path}: {body}", file=sys.stderr)
        raise


def upload(img: Path, repo: str, pr_number: str) -> str:
    """
    Upload a single PNG to the screenshots branch and return its raw GitHub URL.

    The GitHub Contents API requires the existing file's SHA when updating — a missing
    SHA means "create", a present SHA means "update". We GET first to retrieve it.

    @param img - Path to the PNG file
    @param repo - GitHub repository in owner/repo format
    @param pr_number - Pull request number used to namespace the stored file
    @returns Raw githubusercontent URL suitable for embedding in markdown
    """
    filename = img.name
    content = base64.b64encode(img.read_bytes()).decode()
    api_path = f"repos/{repo}/contents/screenshots/{pr_number}-{filename}"

    existing = gh_api("GET", f"{api_path}?ref=screenshots")
    sha = existing.get("sha")

    payload: dict = {
        "message": f"chore: {'update' if sha else 'add'} screenshot for PR #{pr_number}",
        "content": content,
        "branch": "screenshots",
    }
    if sha:
        payload["sha"] = sha

    gh_api("PUT", api_path, payload)
    return f"https://raw.githubusercontent.com/{repo}/screenshots/screenshots/{pr_number}-{filename}"


def main() -> None:
    """
    Upload all changed screenshots and print markdown to stdout.

    Iterates over *-after.png files in SCREENSHOT_DIR. For each, checks whether a
    matching *-before.png exists (written by diff-screenshots.py for changed sections).
    Renders a two-column Before/After table for changed sections, or a single image
    labelled "(new)" for sections with no baseline.

    Prints empty string if no changed screenshots exist, leaving the PR description
    markers in place but empty.
    """
    repo = os.environ["REPO"]
    pr_number = os.environ["PR_NUMBER"]
    screenshot_dir = Path(os.environ.get("SCREENSHOT_DIR", "pr-screenshots-changed"))

    after_files = sorted(screenshot_dir.glob("*-after.png"))
    if not after_files:
        print("", end="")
        return

    markdown = ""
    for after_img in after_files:
        # Recover the original screenshot name, e.g. "hero-light-after" -> "hero-light".
        base_name = after_img.stem.removesuffix("-after")
        before_img = screenshot_dir / f"{base_name}-before.png"

        after_url = upload(after_img, repo, pr_number)

        if before_img.exists():
            before_url = upload(before_img, repo, pr_number)
            markdown += (
                f"**{base_name}**\n\n"
                f"| Before | After |\n"
                f"|--------|-------|\n"
                f"| ![{base_name} before]({before_url}) | ![{base_name} after]({after_url}) |\n\n"
            )
        else:
            markdown += f"**{base_name}** _(new)_\n![{base_name}]({after_url})\n\n"

    print(markdown, end="")


main()
