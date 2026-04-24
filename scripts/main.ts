/**
 * Orchestrator for the screenshot action.
 *
 * On pull_request events: captures "after" screenshots from the already-running
 * server, checks out base-ref in a worktree to capture "before" screenshots,
 * diffs them, and injects a before/after table into the PR description.
 */

import { capture } from "./capture.js";
import { diff } from "./diff.js";
import { uploadAndInject } from "./upload.js";
import { addWorktree, removeWorktree } from "./lib/git.js";
import { startBaseServer, stopServer } from "./lib/server.js";

const {
  GITHUB_TOKEN,
  REPO,
  EVENT_NAME,
  PR_NUMBER,
  BASE_URL = "http://localhost:3000",
  BASE_REF = "main",
  BASE_PORT = "3001",
  INSTALL_COMMAND = "npm ci",
  BUILD_COMMAND = "npm run build",
  SERVE_COMMAND = "npm start",
  DARK_MODE_LABEL = "",
} = process.env;

/**
 * Entry point.
 */
const main = async (): Promise<void> => {
  if (EVENT_NAME !== "pull_request") {
    console.log(`[main] event is "${EVENT_NAME}" — nothing to do`);
    return;
  }

  if (!PR_NUMBER) {
    throw new Error("PR_NUMBER is required on pull_request events");
  }

  // --- Capture "after" (current PR state, server already running) ---
  console.log(`[main] capturing after screenshots from ${BASE_URL}`);
  const afterScreenshots = await capture({
    baseUrl: BASE_URL,
    outputDir: "screenshots-after",
    darkModeLabel: DARK_MODE_LABEL || undefined,
  });

  // --- Capture "before" (base-ref in a worktree) ---
  let beforeScreenshots: Record<string, { light: string; dark?: string }> = {};
  let baseProc = null;
  const worktreePath = addWorktree(BASE_REF);

  if (worktreePath) {
    try {
      const port = Number(BASE_PORT);
      const baseUrl = `http://localhost:${port}`;

      baseProc = await startBaseServer({
        cwd: worktreePath,
        installCommand: INSTALL_COMMAND,
        buildCommand: BUILD_COMMAND,
        serveCommand: SERVE_COMMAND,
        port,
      });

      console.log(`[main] capturing before screenshots from ${baseUrl}`);
      beforeScreenshots = await capture({
        baseUrl,
        outputDir: "screenshots-before",
        darkModeLabel: DARK_MODE_LABEL || undefined,
      });
    } catch (err) {
      console.warn(
        `[main] could not capture before screenshots: ${(err as Error).message}`
      );
      console.warn("[main] all sections will be marked as (new)");
      beforeScreenshots = {};
    } finally {
      if (baseProc) {
        stopServer(baseProc);
      }
      removeWorktree();
    }
  }

  // --- Diff ---
  console.log("[main] diffing screenshots");
  const diffs = diff(beforeScreenshots, afterScreenshots);

  // --- Upload + inject ---
  if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is required");
  }
  if (!REPO) {
    throw new Error("REPO is required");
  }

  await uploadAndInject({
    diffs,
    prNumber: PR_NUMBER,
    repo: REPO,
    token: GITHUB_TOKEN,
  });

  console.log("[main] done");
};

main().catch((err) => {
  console.error("[main] fatal:", (err as Error).message);
  process.exit(1);
});
