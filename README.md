# screenshot-action

GitHub composite action for element-level PR screenshots with before/after diff.

Captures sections marked with `data-screenshot` attributes, compares them pixel-by-pixel against the base ref, and injects a before/after table into the PR description. Only sections that actually changed appear — unchanged sections are silently skipped.

Stateless: no branch storage, no extra workflow steps. Images are uploaded to GitHub's CDN via the issues asset API and live permanently at their URL.

## How it works

```
┌──────────────────────────────────────────────────────────┐
│ On pull_request                                           │
│                                                          │
│  1. Capture "after" from the already-running server      │
│  2. Check out base-ref in a git worktree                 │
│  3. Build + serve base-ref on a side port                │
│  4. Capture "before" from base-ref server                │
│  5. Pixel-diff each section                              │
│  6. Upload changed images to GitHub CDN                  │
│  7. Inject before/after table into PR description        │
│                                                          │
│  Changed section: before/after table in PR description   │
│  New section (no baseline): single image labelled (new)  │
│  Unchanged section: not shown                            │
└──────────────────────────────────────────────────────────┘
```

If the base ref does not exist (e.g. the very first PR in a repo), the before step is skipped gracefully and all sections are marked as new.

## Usage

Mark any section worth reviewing with a `data-screenshot` attribute:

```tsx
<section data-screenshot="hero">...</section>
<section data-screenshot="projects">...</section>
```

Add the action to your CI after your dev server is running:

```yaml
- name: Build and start server
  run: |
    pnpm build && pnpm start &
    until curl -sf http://localhost:3000; do sleep 1; done

- name: PR Screenshots
  uses: owenw2k/screenshot-action@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    pr-number: ${{ github.event.pull_request.number }}
    install-command: pnpm install --frozen-lockfile
    build-command: pnpm build
    serve-command: pnpm start
    dark-mode-toggle-label: "switch to dark mode"
```

Your CI job needs `pull-requests: write` permission:

```yaml
jobs:
  ci:
    permissions:
      pull-requests: write
```

> **If your repo runs Playwright e2e tests**, install the Node Playwright browsers
> before your e2e step — the action installs its own internal copy which is a
> separate executable:
>
> ```yaml
> - name: Install Playwright browsers
>   run: pnpm exec playwright install --with-deps chromium
> ```
>
> Place this before your `test:e2e` step. If you skip it, e2e tests will fail
> with "Executable doesn't exist".

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | yes | | Token with `pull-requests:write` |
| `pr-number` | no | `""` | PR number — pass `${{ github.event.pull_request.number }}` |
| `base-url` | no | `http://localhost:3000` | URL of the already-running "after" server |
| `base-ref` | no | `main` | Branch or ref to capture "before" screenshots from |
| `install-command` | no | `npm ci` | Dependency install command for the base-ref worktree |
| `build-command` | no | `npm run build` | Build command for the base-ref worktree |
| `serve-command` | no | `npm start` | Server start command for the base-ref worktree |
| `dark-mode-toggle-label` | no | `""` | Accessible label of the dark-mode toggle. Omit to capture light mode only. |

## Optional inputs explained

- **`pr-number`** — Pass `${{ github.event.pull_request.number }}`. The action skips everything silently on non-`pull_request` events, so it is safe to include this step unconditionally in a job that runs on both push and PR triggers.

- **`base-url`** — Only override if your dev server runs on a port other than 3000, or if the action runs on a different host. The default `http://localhost:3000` works for most Next.js and Vite setups.

- **`base-ref`** — The ref to compare against. Defaults to `main`. If the ref does not exist (e.g. the very first PR in a repo), the action skips "before" screenshots gracefully and marks all sections as new.

- **`install-command`**, **`build-command`**, **`serve-command`** — Used to build and serve the base-ref in a temporary git worktree so "before" screenshots can be captured. Defaults assume npm. For pnpm or yarn, override all three:
  ```yaml
  with:
    install-command: pnpm install --frozen-lockfile
    build-command: pnpm build
    serve-command: pnpm start
  ```

- **`dark-mode-toggle-label`** — If your site has a dark mode toggle, pass the accessible label (or a substring, case-insensitive). The action clicks the button matching that label and captures dark-mode variants for every section. Omit to capture light mode only.

  The toggle must be reachable via `getByRole("button", { name: /label/i })`. For example, if your toggle has `aria-label="Switch to dark mode"`, pass `"switch to dark mode"` or just `"dark mode"`.

## Versioning

Use `@v2` to always get the latest v2.x release. Use `@v2.0` or `@v2.1` to pin to a specific version. The floating `v2` tag is force-updated on every release.

## How sections are captured

Screenshots are captured at 1280x800. Each `[data-screenshot]` element on every page reachable from `base-url` is captured individually — element-level, not full-page — so the diff only shows what actually changed.

## How images are hosted

All images are uploaded to GitHub's user-attachments API
(`uploads.github.com/repos/{owner}/{repo}/issues/{pr}/assets`). They are
hosted permanently on GitHub's CDN — no screenshots branch or artifact storage
needed.
