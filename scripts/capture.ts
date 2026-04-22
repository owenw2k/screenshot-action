/**
 * Screenshot capture: finds all [data-screenshot] sections on a page and
 * captures each in light mode. If a dark-mode toggle label is provided,
 * also captures in dark mode.
 */

import fs from "fs";
import path from "path";
import { chromium, Page } from "@playwright/test";

interface CaptureOpts {
  baseUrl: string;
  outputDir: string;
  darkModeLabel?: string;
}

interface ScreenshotResult {
  light: string;
  dark?: string;
}

/**
 * Captures screenshots for all [data-screenshot] sections reachable via baseUrl.
 *
 * @param opts - Capture options including baseUrl, output directory, and optional dark mode label.
 * @returns Map of section name to file paths of the captured PNGs.
 */
export const capture = async ({
  baseUrl,
  outputDir,
  darkModeLabel,
}: CaptureOpts): Promise<Record<string, ScreenshotResult>> => {
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch();
  const results: Record<string, ScreenshotResult> = {};

  try {
    // Light mode pass
    const lightPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await lightPage.goto(baseUrl, { waitUntil: "networkidle" });

    const sections = await lightPage.$$("[data-screenshot]");
    if (sections.length === 0) {
      console.log("[capture] no [data-screenshot] elements found — nothing to capture");
      return results;
    }

    for (const section of sections) {
      const name = (await section.getAttribute("data-screenshot")) || "unknown";
      const filePath = path.join(outputDir, `${name}-light.png`);
      await section.screenshot({ path: filePath });
      results[name] = { light: filePath };
      console.log(`[capture] ${name} (light) → ${filePath}`);
    }

    await lightPage.close();

    // Dark mode pass — only when a toggle label is configured
    if (darkModeLabel) {
      const darkPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await darkPage.goto(baseUrl, { waitUntil: "networkidle" });

      const toggle = darkPage.getByRole("button", { name: new RegExp(darkModeLabel, "i") });
      if ((await toggle.count()) > 0) {
        await toggle.click();
        await darkPage.waitForTimeout(300);

        const darkSections = await darkPage.$$("[data-screenshot]");
        for (const section of darkSections) {
          const name = (await section.getAttribute("data-screenshot")) || "unknown";
          const filePath = path.join(outputDir, `${name}-dark.png`);
          await section.screenshot({ path: filePath });
          if (results[name]) {
            results[name].dark = filePath;
          }
          console.log(`[capture] ${name} (dark) → ${filePath}`);
        }
      } else {
        console.log(`[capture] dark-mode toggle not found — skipping dark captures`);
      }

      await darkPage.close();
    }
  } finally {
    await browser.close();
  }

  return results;
};
