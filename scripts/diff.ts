/**
 * Pixel-level image diff using pixelmatch + pngjs.
 * Compares before and after screenshot sets and returns only the sections
 * that actually changed (or are new with no before).
 */

import fs from "fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

/** Pixel-difference threshold passed to pixelmatch (0 = exact, 1 = lenient). */
const DIFF_THRESHOLD = 0.1;

interface ScreenshotResult {
  light: string;
  dark?: string;
}

interface DiffEntry {
  isNew: boolean;
  before?: ScreenshotResult;
  after: ScreenshotResult;
}

/**
 * Reads a PNG file and returns a parsed PNG object.
 *
 * @param filePath - Path to the PNG file.
 * @returns Parsed pngjs PNG instance.
 */
const readPng = (filePath: string): PNG => PNG.sync.read(fs.readFileSync(filePath));

/**
 * Returns true if two PNG files differ by more than zero pixels above the threshold.
 *
 * @param beforePath - Path to the "before" PNG.
 * @param afterPath - Path to the "after" PNG.
 * @returns True when the images differ.
 */
const imagesAreDifferent = (beforePath: string, afterPath: string): boolean => {
  const before = readPng(beforePath);
  const after = readPng(afterPath);

  // Different dimensions always counts as changed
  if (before.width !== after.width || before.height !== after.height) {
    return true;
  }

  const diffPixels = pixelmatch(before.data, after.data, null, before.width, before.height, {
    threshold: DIFF_THRESHOLD,
  });

  return diffPixels > 0;
};

/**
 * Compares two screenshot sets and returns only the sections that changed or are new.
 *
 * @param before - Map of section name to before-screenshot paths. Empty object when no baselines exist.
 * @param after - Map of section name to after-screenshot paths.
 * @returns Only the changed or new sections.
 */
export const diff = (
  before: Record<string, ScreenshotResult>,
  after: Record<string, ScreenshotResult>
): Record<string, DiffEntry> => {
  const changed: Record<string, DiffEntry> = {};

  for (const [name, afterPaths] of Object.entries(after)) {
    const beforePaths = before[name];

    if (!beforePaths) {
      changed[name] = { isNew: true, after: afterPaths };
      console.log(`[diff] ${name} → new section`);
      continue;
    }

    const lightChanged = imagesAreDifferent(beforePaths.light, afterPaths.light);

    const darkChanged =
      beforePaths.dark && afterPaths.dark
        ? imagesAreDifferent(beforePaths.dark, afterPaths.dark)
        : false;

    if (lightChanged || darkChanged) {
      changed[name] = { isNew: false, before: beforePaths, after: afterPaths };
      console.log(`[diff] ${name} → changed`);
    } else {
      console.log(`[diff] ${name} → unchanged, skipping`);
    }
  }

  return changed;
};
