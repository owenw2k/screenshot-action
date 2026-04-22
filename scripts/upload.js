/**
 * Uploads PNG screenshots to the GitHub user-attachments API and injects
 * a before/after markdown table into the PR description.
 *
 * Images are hosted permanently on GitHub's CDN via the issues asset API —
 * no branch storage needed.
 *
 * @module upload
 */

"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

/** Markers used to find and replace the screenshots block in PR descriptions. */
const MARKER_START = "<!-- screenshots-start -->";
const MARKER_END = "<!-- screenshots-end -->";

/**
 * Uploads a single PNG file to GitHub's user-attachments API.
 *
 * @param {object} opts
 * @param {string} opts.filePath - Path to the PNG to upload.
 * @param {string} opts.repo - Repository in `owner/name` format.
 * @param {string} opts.prNumber - PR number (used as the issue number for the asset API).
 * @param {string} opts.token - GitHub token.
 * @returns {Promise<string>} Permanent CDN URL of the uploaded image.
 */
const uploadImage = ({ filePath, repo, prNumber, token }) =>
  new Promise((resolve, reject) => {
    const data = fs.readFileSync(filePath);
    const filename = encodeURIComponent(path.basename(filePath));
    const [owner, repoName] = repo.split("/");

    const options = {
      hostname: "uploads.github.com",
      path: `/repos/${owner}/${repoName}/issues/${prNumber}/assets?name=${filename}`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/png",
        "Content-Length": data.length,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode !== 201) {
          reject(new Error(`Upload failed (${res.statusCode}): ${body}`));
          return;
        }
        const { url } = JSON.parse(body);
        resolve(url);
      });
    });

    req.on("error", reject);
    req.write(data);
    req.end();
  });

/**
 * Fetches the current PR body via the GitHub REST API.
 *
 * @param {object} opts
 * @param {string} opts.repo - Repository in `owner/name` format.
 * @param {string} opts.prNumber - PR number.
 * @param {string} opts.token - GitHub token.
 * @returns {Promise<string>} Current PR body text.
 */
const getPrBody = ({ repo, prNumber, token }) =>
  new Promise((resolve, reject) => {
    const [owner, repoName] = repo.split("/");
    const options = {
      hostname: "api.github.com",
      path: `/repos/${owner}/${repoName}/pulls/${prNumber}`,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "screenshot-action",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    };

    https.get(options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch PR (${res.statusCode}): ${body}`));
          return;
        }
        resolve(JSON.parse(body).body ?? "");
      });
    });
  });

/**
 * Updates the PR body via the GitHub REST API.
 *
 * @param {object} opts
 * @param {string} opts.repo - Repository in `owner/name` format.
 * @param {string} opts.prNumber - PR number.
 * @param {string} opts.token - GitHub token.
 * @param {string} opts.body - New PR body text.
 * @returns {Promise<void>}
 */
const updatePrBody = ({ repo, prNumber, token, body }) =>
  new Promise((resolve, reject) => {
    const [owner, repoName] = repo.split("/");
    const payload = JSON.stringify({ body });

    const options = {
      hostname: "api.github.com",
      path: `/repos/${owner}/${repoName}/pulls/${prNumber}`,
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "screenshot-action",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    };

    const req = https.request(options, (res) => {
      res.resume();
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to update PR body (${res.statusCode})`));
        return;
      }
      resolve();
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });

/**
 * Builds the markdown screenshot table for a single section.
 *
 * @param {string} name - Section name from the data-screenshot attribute.
 * @param {object} entry - Diff entry with isNew, before, and after paths.
 * @param {object} urls - Uploaded image URLs keyed by file path.
 * @returns {string} Markdown fragment for this section.
 */
const buildSectionMarkdown = (name, entry, urls) => {
  const heading = `### ${name}`;

  if (entry.isNew) {
    const lightUrl = urls[entry.after.light];
    const darkUrl = entry.after.dark ? urls[entry.after.dark] : null;

    const rows = darkUrl
      ? `| Light (new) | Dark (new) |\n|---|---|\n| ![${name} light](${lightUrl}) | ![${name} dark](${darkUrl}) |`
      : `| Light (new) |\n|---|\n| ![${name} light](${lightUrl}) |`;

    return `${heading}\n\n${rows}`;
  }

  const beforeLight = urls[entry.before.light];
  const afterLight = urls[entry.after.light];

  if (entry.before.dark && entry.after.dark) {
    const beforeDark = urls[entry.before.dark];
    const afterDark = urls[entry.after.dark];
    return (
      `${heading}\n\n` +
      `| | Before | After |\n|---|---|---|\n` +
      `| Light | ![before light](${beforeLight}) | ![after light](${afterLight}) |\n` +
      `| Dark | ![before dark](${beforeDark}) | ![after dark](${afterDark}) |`
    );
  }

  return (
    `${heading}\n\n` +
    `| Before | After |\n|---|---|\n` +
    `| ![before](${beforeLight}) | ![after](${afterLight}) |`
  );
};

/**
 * Injects the screenshot table into the PR description, replacing any
 * existing content between the screenshot markers.
 *
 * @param {string} currentBody - Current PR body text.
 * @param {string} screenshotMarkdown - Markdown to inject.
 * @returns {string} Updated PR body.
 */
const injectIntoBody = (currentBody, screenshotMarkdown) => {
  const block = `${MARKER_START}\n${screenshotMarkdown}\n${MARKER_END}`;

  if (currentBody.includes(MARKER_START) && currentBody.includes(MARKER_END)) {
    const startIdx = currentBody.indexOf(MARKER_START);
    const endIdx = currentBody.indexOf(MARKER_END) + MARKER_END.length;
    return currentBody.slice(0, startIdx) + block + currentBody.slice(endIdx);
  }

  return `${currentBody}\n\n${block}`;
};

/**
 * Uploads all changed screenshots, builds a markdown table, and injects it
 * into the PR description.
 *
 * @param {object} opts
 * @param {Record<string, object>} opts.diffs - Output from diff.js.
 * @param {string} opts.prNumber - PR number.
 * @param {string} opts.repo - Repository in `owner/name` format.
 * @param {string} opts.token - GitHub token.
 * @returns {Promise<void>}
 */
const uploadAndInject = async ({ diffs, prNumber, repo, token }) => {
  if (Object.keys(diffs).length === 0) {
    console.log("[upload] no changed sections — PR description unchanged");
    return;
  }

  // Collect all file paths that need to be uploaded
  const filePaths = new Set();
  for (const entry of Object.values(diffs)) {
    filePaths.add(entry.after.light);
    if (entry.after.dark) {
      filePaths.add(entry.after.dark);
    }
    if (!entry.isNew && entry.before) {
      filePaths.add(entry.before.light);
      if (entry.before.dark) {
        filePaths.add(entry.before.dark);
      }
    }
  }

  console.log(`[upload] uploading ${filePaths.size} image(s) to GitHub`);
  const urls = {};
  for (const filePath of filePaths) {
    const url = await uploadImage({ filePath, repo, prNumber, token });
    urls[filePath] = url;
    console.log(`[upload] ${path.basename(filePath)} → ${url}`);
  }

  const sections = Object.entries(diffs)
    .map(([name, entry]) => buildSectionMarkdown(name, entry, urls))
    .join("\n\n");

  const screenshotMarkdown = `## Screenshots\n\n${sections}`;

  const currentBody = await getPrBody({ repo, prNumber, token });
  const newBody = injectIntoBody(currentBody, screenshotMarkdown);
  await updatePrBody({ repo, prNumber, token, body: newBody });
  console.log("[upload] PR description updated");
};

module.exports = { uploadAndInject };
