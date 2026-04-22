/**
 * Helpers for starting and stopping the base-ref dev server in a worktree.
 */

import { ChildProcess, execSync, spawn } from "child_process";
import http from "http";

/**
 * Polls a URL until it responds with a non-error status, up to a timeout.
 *
 * @param url - URL to poll.
 * @param timeoutMs - Maximum wait time in milliseconds.
 * @returns Promise that resolves when the server is ready.
 * @throws Error if the server does not respond within the timeout.
 */
const waitForServer = (url: string, timeoutMs = 60_000): Promise<void> =>
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

interface StartServerOpts {
  cwd: string;
  installCommand: string;
  buildCommand: string;
  serveCommand: string;
  port: number;
}

/**
 * Runs install and build commands in the worktree, then starts the server.
 * Returns the child process so the caller can stop it when done.
 *
 * @param opts - Server options including cwd, commands, and port.
 * @returns Running server process.
 */
export const startBaseServer = async ({
  cwd,
  installCommand,
  buildCommand,
  serveCommand,
  port,
}: StartServerOpts): Promise<ChildProcess> => {
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
 * @param proc - Process to stop.
 */
export const stopServer = (proc: ChildProcess): void => {
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    // process already exited
  }
};
