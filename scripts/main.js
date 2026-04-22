/**
 * Orchestrator for the screenshot action.
 *
 * On pull_request events: captures "after" screenshots from the already-running
 * server, checks out base-ref in a worktree to capture "before" screenshots,
 * diffs them, and injects a before/after table into the PR description.
 *
 * Requires these environment variables (set by action.yml):
 *   GITHUB_TOKEN, REPO, EVENT_NAME, PR_NUMBER,
 *   BASE_URL, BASE_REF, BASE_PORT,
 *   INSTALL_COMMAND, BUILD_COMMAND, SERVE_COMMAND,
 *   DARK_MODE_LABEL
 */

"use strict";

const { capture } = require("./capture");
const { diff } = require("./diff");
const { uploadAndInject } = require("./upload");
const { addWorktree, removeWorktree } = require("./lib/git");
const { startBaseServer, stopServer } = require("./lib/server");

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
 *
 * @returns {Promise<void>}
 */
const main = async () => {
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

  if (Object.keys(afterScreenshots).length === 0) {
    console.log("[main] no sections found — exiting");
    return;
  }

  // --- Capture "before" (base-ref in a worktree) ---
  let beforeScreenshots = {};
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
      console.warn(`[main] could not capture before screenshots: ${err.message}`);
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
  await uploadAndInject({
    diffs,
    prNumber: PR_NUMBER,
    repo: REPO,
    token: GITHUB_TOKEN,
  });

  console.log("[main] done");
};

main().catch((err) => {
  console.error("[main] fatal:", err.message);
  process.exit(1);
});
