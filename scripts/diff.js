/**
 * Pixel-level image diff using pixelmatch + pngjs.
 * Compares before and after screenshot sets and returns only the sections
 * that actually changed (or are new with no before).
 *
 * @module diff
 */

"use strict";

const fs = require("fs");
const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch");

/** Pixel-difference threshold passed to pixelmatch (0 = exact, 1 = lenient). */
const DIFF_THRESHOLD = 0.1;

/**
 * Reads a PNG file and returns a parsed PNG object.
 *
 * @param {string} filePath - Absolute or relative path to the PNG.
 * @returns {PNG} Parsed pngjs PNG instance.
 */
const readPng = (filePath) => PNG.sync.read(fs.readFileSync(filePath));

/**
 * Returns true if two PNG files differ by more than zero pixels above the threshold.
 *
 * @param {string} beforePath - Path to the "before" PNG.
 * @param {string} afterPath - Path to the "after" PNG.
 * @returns {boolean} True when the images differ.
 */
const imagesAreDifferent = (beforePath, afterPath) => {
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
 * @param {Record<string, { light: string, dark?: string }>} before
 *   Map of section name to before-screenshot paths. Pass an empty object when
 *   there are no baselines (e.g. the base ref could not be checked out).
 * @param {Record<string, { light: string, dark?: string }>} after
 *   Map of section name to after-screenshot paths.
 * @returns {Record<string, { isNew: boolean, before?: { light: string, dark?: string }, after: { light: string, dark?: string } }>}
 *   Only the changed or new sections.
 */
const diff = (before, after) => {
  const changed = {};

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

module.exports = { diff };
