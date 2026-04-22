#!/usr/bin/env python3
"""
Upload current screenshots as main-branch baselines to the screenshots branch.
Run on every push to main so the next PR diff has an up-to-date comparison target.

Baselines are stored at main/{filename} on the screenshots branch, e.g.:
  main/hero-light.png
  main/hero-dark.png

Required env vars: GITHUB_TOKEN, REPO
Input: pr-screenshots/*.png
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


def main() -> None:
    """
    Upload every PNG in pr-screenshots/ to the screenshots branch at main/{filename}.

    The GitHub Contents API requires the existing file's SHA when updating — a missing
    SHA means "create", a present SHA means "update". We GET first to retrieve it.
    """
    repo = os.environ["REPO"]
    src = Path("pr-screenshots")

    for img in sorted(src.glob("*.png")):
        api_path = f"repos/{repo}/contents/main/{img.name}"

        # GET the existing file to retrieve its SHA; the Contents API rejects an
        # update request without it (returns 422 "Invalid request").
        existing = gh_api("GET", f"{api_path}?ref=screenshots")
        sha = existing.get("sha")

        payload: dict = {
            "message": f"chore: update screenshot baseline {img.name}",
            "content": base64.b64encode(img.read_bytes()).decode(),
            "branch": "screenshots",
        }
        if sha:
            payload["sha"] = sha

        gh_api("PUT", api_path, payload)
        print(f"  stored: {img.name}", file=sys.stderr)


main()
