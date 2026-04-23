/**
 * Uploads PNG screenshots to the GitHub user-attachments API and injects
 * a before/after markdown table into the PR description.
 *
 * Images are hosted permanently on GitHub's CDN via the issues asset API —
 * no branch storage needed.
 */

import fs from "fs";
import https from "https";
import path from "path";

/** Markers used to find and replace the screenshots block in PR descriptions. */
const MARKER_START = "<!-- screenshots-start -->";
const MARKER_END = "<!-- screenshots-end -->";

interface DiffEntry {
  isNew: boolean;
  before?: { light: string; dark?: string };
  after: { light: string; dark?: string };
}

interface UploadOpts {
  filePath: string;
  repo: string;
  prNumber: string;
  token: string;
}

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
 * Uploads a single PNG file to GitHub's user-attachments API using a manually
 * constructed multipart/form-data body.
 *
 * The entire body is built as a single Buffer before the request is made, so
 * Content-Length is guaranteed to equal the actual bytes sent.
 *
 * @param opts - Upload options including file path, repo, PR number, and token.
 * @returns Permanent CDN URL of the uploaded image.
 * @throws {Error} If the upload fails or the response cannot be parsed.
 */
const uploadImage = ({ filePath, repo, prNumber, token }: UploadOpts): Promise<string> => {
  const [owner, repoName] = repo.split("/");
  const filename = path.basename(filePath);
  const fileData = fs.readFileSync(filePath);

  const boundary = `----ScreenshotActionBoundary${Date.now().toString(16)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: image/png\r\n` +
      `\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([head, fileData, tail]);

  console.log(`[upload] ${filename}: file=${fileData.length}B body=${body.length}B`);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "uploads.github.com",
        path: `/repos/${owner}/${repoName}/issues/${prNumber}/assets?name=${encodeURIComponent(filename)}`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "screenshot-action",
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(body.length),
        },
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk: Buffer) => {
          responseBody += chunk.toString();
        });
        res.on("end", () => {
          console.log(`[upload] response ${res.statusCode}: ${responseBody.slice(0, 300)}`);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            const { url } = JSON.parse(responseBody) as { url: string };
            resolve(url);
          } else {
            reject(new Error(`Upload failed (${res.statusCode}): ${responseBody}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
};

/**
 * Fetches the current PR body via the GitHub REST API.
 *
 * @param opts - PR options including repo, PR number, and token.
 * @returns Current PR body text.
 */
const getPrBody = async ({ repo, prNumber, token }: PrOpts): Promise<string> => {
  const [owner, repoName] = repo.split("/");
  const res = await fetch(`https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "screenshot-action",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch PR (${res.status})`);
  }

  const data = (await res.json()) as { body: string | null };
  return data.body ?? "";
};

/**
 * Updates the PR body via the GitHub REST API.
 *
 * @param opts - PR options including repo, PR number, token, and new body.
 */
const updatePrBody = async ({
  repo,
  prNumber,
  token,
  body,
}: PrOpts & { body: string }): Promise<void> => {
  const [owner, repoName] = repo.split("/");
  const res = await fetch(`https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "screenshot-action",
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    throw new Error(`Failed to update PR body (${res.status})`);
  }
};

/**
 * Builds the markdown screenshot table for a single section.
 *
 * @param name - Section name from the data-screenshot attribute.
 * @param entry - Diff entry with isNew, before, and after paths.
 * @param urls - Uploaded image URLs keyed by file path.
 * @returns Markdown fragment for this section.
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
 * @param currentBody - Current PR body text.
 * @param screenshotMarkdown - Markdown to inject.
 * @returns Updated PR body.
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
 * Uploads all changed screenshots, builds a markdown table, and injects it
 * into the PR description.
 *
 * @param opts - Upload and inject options including diffs, PR number, repo, and token.
 */
export const uploadAndInject = async ({
  diffs,
  prNumber,
  repo,
  token,
}: InjectOpts): Promise<void> => {
  if (Object.keys(diffs).length === 0) {
    console.log("[upload] no changed sections — PR description unchanged");
    return;
  }

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

  console.log(`[upload] uploading ${filePaths.size} image(s) to GitHub`);
  const urls: Record<string, string> = {};
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
