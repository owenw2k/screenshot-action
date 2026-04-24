/**
 * Uploads PNG screenshots to a hidden GitHub release used as a CDN and injects
 * a before/after markdown table into the PR description.
 *
 * Images are stored as release assets on a `screenshots-cdn` pre-release in the
 * target repo. This avoids branch storage while using a documented, GITHUB_TOKEN-
 * compatible upload endpoint (unlike the issues asset API which rejects programmatic
 * uploads).
 */

import fs from "fs";
import https from "https";
import path from "path";

/** Markers used to find and replace the screenshots block in PR descriptions. */
const MARKER_START = "<!-- screenshots-start -->";
const MARKER_END = "<!-- screenshots-end -->";

/** Tag used for the hidden CDN release that stores screenshot assets. */
const CDN_RELEASE_TAG = "screenshots-cdn";

interface DiffEntry {
  isNew: boolean;
  before?: { light: string; dark?: string };
  after: { light: string; dark?: string };
}

interface UploadOpts {
  filePath: string;
  assetName: string;
  releaseId: number;
  repo: string;
  token: string;
}

/**
 * Derives a unique CDN asset name from a screenshot file path.
 * Includes the "before" or "after" directory segment so before and after
 * images for the same section don't overwrite each other.
 *
 * @param prNumber - Pull request number.
 * @param filePath - Path to the screenshot file, e.g. "screenshots-before/hero-light.png".
 * @returns Asset name, e.g. "pr26-before-hero-light.png".
 */
const toAssetName = (prNumber: string, filePath: string): string => {
  const dir = path.basename(path.dirname(filePath));
  const prefix = dir === "screenshots-before" ? "before-" : "after-";
  return `pr${prNumber}-${prefix}${path.basename(filePath)}`;
};

interface PrOpts {
  repo: string;
  prNumber: string;
  token: string;
}

interface InjectOpts {
  diffs: Record<string, DiffEntry>;
  prNumber: string;
  repo: string;
  token: string;
}

/**
 * Makes an authenticated request to the GitHub REST API.
 *
 * @param method - HTTP method (GET, POST, DELETE, PATCH)
 * @param path - API path starting with `/repos/...`
 * @param token - GitHub token for Authorization header
 * @param body - Optional JSON body for POST/PATCH requests
 * @returns Parsed JSON response body
 * @throws {Error} If the response status is not 2xx
 */
const ghApi = async (
  method: string,
  apiPath: string,
  token: string,
  body?: unknown
): Promise<unknown> => {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "screenshot-action",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`GitHub API ${method} ${apiPath} failed (${res.status}): ${text}`);
  }

  if (res.status === 204 || res.status === 404) {
    return null;
  }

  return res.json();
};

/**
 * Finds the `screenshots-cdn` pre-release in the repo, creating it if it does not exist.
 *
 * The release is created as a pre-release so it does not appear as the latest release
 * in the repo's releases page and does not trigger release notifications.
 *
 * @param repo - GitHub repository in `owner/repo` format
 * @param token - GitHub token
 * @returns The numeric release ID
 * @throws {Error} If the release cannot be found or created
 */
const getOrCreateCdnRelease = async (repo: string, token: string): Promise<number> => {
  const existing = (await ghApi("GET", `/repos/${repo}/releases/tags/${CDN_RELEASE_TAG}`, token)) as
    | { id: number }
    | null;

  if (existing?.id) {
    console.log(`[upload] using existing CDN release id=${existing.id}`);
    return existing.id;
  }

  console.log(`[upload] creating ${CDN_RELEASE_TAG} pre-release`);
  const created = (await ghApi("POST", `/repos/${repo}/releases`, token, {
    tag_name: CDN_RELEASE_TAG,
    name: "Screenshot CDN",
    body: "Internal release used to host PR screenshot assets. Do not delete.",
    prerelease: true,
    draft: false,
  })) as { id: number };

  console.log(`[upload] created CDN release id=${created.id}`);
  return created.id;
};

/**
 * Deletes an existing release asset by name if one exists, so re-runs overwrite cleanly.
 *
 * @param repo - GitHub repository in `owner/repo` format
 * @param releaseId - Numeric ID of the release
 * @param assetName - Asset filename to delete
 * @param token - GitHub token
 */
const deleteExistingAsset = async (
  repo: string,
  releaseId: number,
  assetName: string,
  token: string
): Promise<void> => {
  const assets = (await ghApi(
    "GET",
    `/repos/${repo}/releases/${releaseId}/assets?per_page=100`,
    token
  )) as Array<{ id: number; name: string }> | null;

  if (!assets) {
    return;
  }

  const existing = assets.find((a) => a.name === assetName);
  if (existing) {
    console.log(`[upload] deleting existing asset ${assetName} (id=${existing.id})`);
    await ghApi("DELETE", `/repos/${repo}/releases/assets/${existing.id}`, token);
  }
};

/**
 * Uploads a single PNG file to a GitHub release as a raw binary asset.
 *
 * Uses `https.request` directly so we can stream the raw Buffer with a guaranteed
 * Content-Length header. The release asset endpoint requires raw binary (not multipart).
 *
 * @param opts - Upload options including file path, release ID, repo, PR number, and token
 * @returns Permanent `browser_download_url` for the uploaded asset
 * @throws {Error} If the upload fails or the response cannot be parsed
 */
const uploadImage = ({ filePath, assetName, releaseId, repo, token }: UploadOpts): Promise<string> =>
  new Promise((resolve, reject) => {
    const fileData = fs.readFileSync(filePath);

    console.log(`[upload] ${assetName}: ${fileData.length}B`);

    const req = https.request(
      {
        hostname: "uploads.github.com",
        path: `/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "screenshot-action",
          "Content-Type": "image/png",
          "Content-Length": String(fileData.length),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          console.log(`[upload] response ${res.statusCode}: ${body.slice(0, 300)}`);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            const { browser_download_url } = JSON.parse(body) as { browser_download_url: string };
            resolve(browser_download_url);
          } else {
            reject(new Error(`Upload failed (${res.statusCode}): ${body}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(fileData);
    req.end();
  });

/**
 * Fetches the current PR body via the GitHub REST API.
 *
 * @param opts - PR options including repo, PR number, and token
 * @returns Current PR body text
 * @throws {Error} If the API request fails
 */
const getPrBody = async ({ repo, prNumber, token }: PrOpts): Promise<string> => {
  const data = (await ghApi("GET", `/repos/${repo}/pulls/${prNumber}`, token)) as {
    body: string | null;
  };
  return data?.body ?? "";
};

/**
 * Updates the PR body via the GitHub REST API.
 *
 * @param opts - PR options including repo, PR number, token, and new body
 * @throws {Error} If the API request fails
 */
const updatePrBody = async ({
  repo,
  prNumber,
  token,
  body,
}: PrOpts & { body: string }): Promise<void> => {
  await ghApi("PATCH", `/repos/${repo}/pulls/${prNumber}`, token, { body });
};

/**
 * Builds the markdown screenshot table for a single section.
 *
 * @param name - Section name from the data-screenshot attribute
 * @param entry - Diff entry with isNew, before, and after paths
 * @param urls - Uploaded image URLs keyed by file path
 * @returns Markdown fragment for this section
 */
const buildSectionMarkdown = (
  name: string,
  entry: DiffEntry,
  urls: Record<string, string>
): string => {
  const heading = `### ${name}`;

  if (entry.isNew) {
    const lightUrl = urls[entry.after.light];
    const darkUrl = entry.after.dark ? urls[entry.after.dark] : null;

    const rows = darkUrl
      ? `| Light (new) | Dark (new) |\n|---|---|\n| ![${name} light](${lightUrl}) | ![${name} dark](${darkUrl}) |`
      : `| Light (new) |\n|---|\n| ![${name} light](${lightUrl}) |`;

    return `${heading}\n\n${rows}`;
  }

  const beforeLight = urls[entry.before!.light];
  const afterLight = urls[entry.after.light];

  if (entry.before?.dark && entry.after.dark) {
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
 * @param currentBody - Current PR body text
 * @param screenshotMarkdown - Markdown to inject
 * @returns Updated PR body
 */
const injectIntoBody = (currentBody: string, screenshotMarkdown: string): string => {
  const block = `${MARKER_START}\n${screenshotMarkdown}\n${MARKER_END}`;

  if (currentBody.includes(MARKER_START) && currentBody.includes(MARKER_END)) {
    const startIdx = currentBody.indexOf(MARKER_START);
    const endIdx = currentBody.indexOf(MARKER_END) + MARKER_END.length;
    return currentBody.slice(0, startIdx) + block + currentBody.slice(endIdx);
  }

  return `${currentBody}\n\n${block}`;
};

/**
 * Uploads all changed screenshots to the CDN release, builds a markdown table,
 * and injects it into the PR description.
 *
 * @param opts - Upload and inject options including diffs, PR number, repo, and token
 */
export const uploadAndInject = async ({
  diffs,
  prNumber,
  repo,
  token,
}: InjectOpts): Promise<void> => {
  if (Object.keys(diffs).length === 0) {
    console.log("[upload] no changed sections — removing any existing screenshots block");
    const currentBody = await getPrBody({ repo, prNumber, token });
    if (currentBody.includes(MARKER_START) && currentBody.includes(MARKER_END)) {
      const startIdx = currentBody.indexOf(MARKER_START);
      const endIdx = currentBody.indexOf(MARKER_END) + MARKER_END.length;
      const newBody = currentBody.slice(0, startIdx) + currentBody.slice(endIdx).replace(/^\n/, "");
      await updatePrBody({ repo, prNumber, token, body: newBody });
      console.log("[upload] screenshots block removed");
    }
    return;
  }

  const releaseId = await getOrCreateCdnRelease(repo, token);

  // Collect all file paths that need to be uploaded
  const filePaths = new Set<string>();
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

  console.log(`[upload] uploading ${filePaths.size} image(s) to release id=${releaseId}`);
  const urls: Record<string, string> = {};
  for (const filePath of filePaths) {
    const assetName = toAssetName(prNumber, filePath);
    await deleteExistingAsset(repo, releaseId, assetName, token);
    const url = await uploadImage({ filePath, assetName, releaseId, repo, token });
    urls[filePath] = url;
    console.log(`[upload] ${assetName} → ${url}`);
  }

  const sections = Object.entries(diffs)
    .map(([name, entry]) => buildSectionMarkdown(name, entry, urls))
    .join("\n\n");

  const screenshotMarkdown = sections;

  const currentBody = await getPrBody({ repo, prNumber, token });
  const newBody = injectIntoBody(currentBody, screenshotMarkdown);
  await updatePrBody({ repo, prNumber, token, body: newBody });
  console.log("[upload] PR description updated");
};
