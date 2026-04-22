#!/usr/bin/env python3
"""
Capture element-level screenshots of sections marked with data-screenshot attributes.

Launches a headless Chromium browser, navigates to the target URL, and screenshots
every element that has a data-screenshot="section-name" attribute — once in light
mode and once in dark mode. Output files are named {section-name}-{scheme}.png.

Add data-screenshot="section-name" to any element worth reviewing in a PR.
The script discovers them automatically, so no changes here are needed when
sections are added or removed.

Optional env vars:
  BASE_URL  - URL to screenshot (default: http://localhost:3000)

Output: pr-screenshots/{name}-light.png and pr-screenshots/{name}-dark.png
"""

import os
import re
import sys
from pathlib import Path


def check_dependencies() -> None:
    """
    Verify that playwright is installed and give a clear error if not.

    playwright is installed by the composite action's setup step. If you see
    this error when running the script directly, install dependencies first:

      pip install -r requirements.txt
      python -m playwright install chromium
    """
    try:
        import playwright  # noqa: F401
    except ImportError:
        print(
            "\nERROR: playwright is not installed.\n"
            "\n"
            "If running via the composite action this should not happen — file an issue.\n"
            "If running locally, install dependencies first:\n"
            "\n"
            "  pip install -r requirements.txt\n"
            "  python -m playwright install chromium\n",
            file=sys.stderr,
        )
        sys.exit(1)


def main() -> None:
    """
    Capture light and dark screenshots of every [data-screenshot] section.

    For dark mode, clicks the button matching 'switch to dark mode' — this assumes
    the UI has a dark mode toggle with that accessible label.
    """
    check_dependencies()

    from playwright.sync_api import sync_playwright

    base_url = os.environ.get("BASE_URL", "http://localhost:3000")
    out_dir = Path("pr-screenshots")
    out_dir.mkdir(exist_ok=True)

    with sync_playwright() as p:
        for scheme in ("light", "dark"):
            browser = p.chromium.launch()
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                color_scheme=scheme,
            )
            page = context.new_page()
            page.goto(base_url, wait_until="networkidle")

            if scheme == "dark":
                page.get_by_role("button", name=re.compile("switch to dark mode", re.I)).click()

            sections = page.locator("[data-screenshot]").all()
            for section in sections:
                name = section.get_attribute("data-screenshot")
                section.screenshot(path=str(out_dir / f"{name}-{scheme}.png"))
                print(f"  captured: {name}-{scheme}.png", file=sys.stderr)

            context.close()
            browser.close()

    print("Screenshots captured in pr-screenshots/", file=sys.stderr)


main()
