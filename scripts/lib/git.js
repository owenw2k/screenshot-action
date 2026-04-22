/**
 * Git worktree helpers for checking out a base ref without touching the main workspace.
 */

"use strict";

const { execSync, spawnSync } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const WORKTREE_PATH = path.join(os.tmpdir(), "screenshot-base");

/**
 * Checks whether a ref exists in the current repository.
 *
 * @param {string} ref - Branch name or commit SHA to check.
 * @returns {boolean} True if the ref can be resolved.
 */
const refExists = (ref) => {
  const result = spawnSync("git", ["rev-parse", "--verify", ref], {
    stdio: "pipe",
  });
  return result.status === 0;
};

/**
 * Creates a detached git worktree at a temporary path for the given ref.
 * Returns null if the ref does not exist, so callers can skip gracefully.
 *
 * @param {string} ref - Branch or commit to check out.
 * @returns {string | null} Absolute path to the worktree, or null if ref not found.
 */
const addWorktree = (ref) => {
  if (!refExists(ref)) {
    console.log(`[git] ref "${ref}" not found — skipping before screenshots`);
    return null;
  }

  if (fs.existsSync(WORKTREE_PATH)) {
    execSync(`git worktree remove "${WORKTREE_PATH}" --force`, { stdio: "inherit" });
  }

  execSync(`git worktree add --detach "${WORKTREE_PATH}" "${ref}"`, {
    stdio: "inherit",
  });

  console.log(`[git] worktree created at ${WORKTREE_PATH} (${ref})`);
  return WORKTREE_PATH;
};

/**
 * Removes the temporary worktree created by addWorktree.
 * Safe to call even if the worktree does not exist.
 */
const removeWorktree = () => {
  try {
    execSync(`git worktree remove "${WORKTREE_PATH}" --force`, { stdio: "pipe" });
    console.log("[git] worktree removed");
  } catch {
    // already gone or never created
  }
};

module.exports = { addWorktree, removeWorktree };
