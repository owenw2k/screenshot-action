/**
 * Git worktree helpers for checking out a base ref without touching the main workspace.
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKTREE_PATH = path.join(os.tmpdir(), "screenshot-base");

// All git commands must run in the hub repo, not in the action's own directory.
const REPO_CWD = process.env.GITHUB_WORKSPACE ?? process.cwd();

/**
 * Checks whether a ref exists in the checked-out repo.
 *
 * @param ref - Branch name or commit SHA to check.
 * @returns True if the ref can be resolved.
 */
const refExists = (ref: string): boolean => {
  const result = spawnSync("git", ["rev-parse", "--verify", ref], { stdio: "pipe", cwd: REPO_CWD });
  return result.status === 0;
};

/**
 * Creates a detached git worktree at a temporary path for the given ref.
 * Returns null if the ref does not exist, so callers can skip gracefully.
 * In shallow clones (fetch-depth: 1), neither the local branch nor the
 * remote tracking ref exists, so we explicitly fetch the ref first using
 * an explicit refspec that writes refs/remotes/origin/<ref>.
 *
 * @param ref - Branch or commit to check out.
 * @returns Absolute path to the worktree, or null if the ref was not found.
 */
export const addWorktree = (ref: string): string | null => {
  if (!refExists(ref) && !refExists(`origin/${ref}`)) {
    try {
      execSync(`git fetch origin "${ref}:refs/remotes/origin/${ref}" --depth=1`, {
        stdio: "pipe",
        cwd: REPO_CWD,
      });
    } catch {
      // ref doesn't exist on remote; fall through to null
    }
  }

  if (!refExists(ref) && !refExists(`origin/${ref}`)) {
    console.log(`[git] ref "${ref}" not found, skipping before screenshots`);
    return null;
  }

  const resolvedRef = refExists(ref) ? ref : `origin/${ref}`;

  if (fs.existsSync(WORKTREE_PATH)) {
    execSync(`git worktree remove "${WORKTREE_PATH}" --force`, { stdio: "inherit", cwd: REPO_CWD });
  }

  execSync(`git worktree add --detach "${WORKTREE_PATH}" "${resolvedRef}"`, {
    stdio: "inherit",
    cwd: REPO_CWD,
  });
  console.log(`[git] worktree created at ${WORKTREE_PATH} (${resolvedRef})`);
  return WORKTREE_PATH;
};

/**
 * Removes the temporary worktree created by addWorktree.
 * Safe to call even if the worktree does not exist.
 */
export const removeWorktree = (): void => {
  try {
    execSync(`git worktree remove "${WORKTREE_PATH}" --force`, { stdio: "pipe", cwd: REPO_CWD });
    console.log("[git] worktree removed");
  } catch {
    // already gone or never created
  }
};
