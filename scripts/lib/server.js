/**
 * Helpers for starting and stopping the base-ref dev server in a worktree.
 */

"use strict";

const { execSync, spawn } = require("child_process");
const http = require("http");

/**
 * Polls a URL until it responds with a non-error status, up to a timeout.
 *
 * @param {string} url - URL to poll.
 * @param {number} timeoutMs - Maximum wait time in milliseconds.
 * @returns {Promise<void>} Resolves when the server is ready.
 * @throws {Error} If the server does not respond within the timeout.
 */
const waitForServer = (url, timeoutMs = 60_000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();

    const poll = () => {
      http
        .get(url, (res) => {
          if (res.statusCode && res.statusCode < 500) {
            resolve();
          } else {
            retry();
          }
          res.resume();
        })
        .on("error", retry);
    };

    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Server at ${url} did not respond within ${timeoutMs}ms`));
        return;
      }
      setTimeout(poll, 500);
    };

    poll();
  });

/**
 * Runs install and build commands in the worktree, then starts the server.
 * Returns the child process so the caller can stop it when done.
 *
 * @param {object} opts
 * @param {string} opts.cwd - Working directory (worktree path).
 * @param {string} opts.installCommand - Shell command to install dependencies.
 * @param {string} opts.buildCommand - Shell command to build the app.
 * @param {string} opts.serveCommand - Shell command to start the server.
 * @param {number} opts.port - Port to start the server on.
 * @returns {Promise<import("child_process").ChildProcess>} Running server process.
 */
const startBaseServer = async ({ cwd, installCommand, buildCommand, serveCommand, port }) => {
  console.log(`[server] installing dependencies in worktree: ${installCommand}`);
  execSync(installCommand, { cwd, stdio: "inherit", shell: true });

  console.log(`[server] building base-ref: ${buildCommand}`);
  execSync(buildCommand, { cwd, stdio: "inherit", shell: true });

  console.log(`[server] starting base-ref server on port ${port}: ${serveCommand}`);
  const proc = spawn(serveCommand, {
    cwd,
    env: { ...process.env, PORT: String(port) },
    shell: true,
    stdio: "pipe",
  });

  await waitForServer(`http://localhost:${port}`, 60_000);
  console.log(`[server] base-ref server ready on port ${port}`);
  return proc;
};

/**
 * Stops a server process spawned by startBaseServer.
 *
 * @param {import("child_process").ChildProcess} proc - Process to stop.
 */
const stopServer = (proc) => {
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    // process already exited
  }
};

module.exports = { startBaseServer, stopServer };
