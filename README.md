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
| `pr-number` | no | `""` | PR number — required on `pull_request` events |
| `base-url` | no | `http://localhost:3000` | URL of the already-running "after" server |
| `base-ref` | no | `main` | Branch or ref to capture "before" screenshots from |
| `install-command` | no | `npm ci` | Dependency install command for the base-ref worktree |
| `build-command` | no | `npm run build` | Build command for the base-ref worktree |
| `serve-command` | no | `npm start` | Server start command for the base-ref worktree |
| `dark-mode-toggle-label` | no | `""` | Accessible label of the dark-mode toggle button. Omit to capture light mode only. |

## Optional inputs explained

These inputs are optional but recommended for non-default setups:

- **`base-ref`** — The ref to compare against. Defaults to `main`. If the ref does not exist, the action skips "before" screenshots gracefully and marks all sections as new.

- **`install-command`**, **`build-command`**, **`serve-command`** — Used to build and run the base-ref in a git worktree. Defaults assume an npm-based project. For pnpm or yarn, override all three:
  ```yaml
  with:
    install-command: pnpm install --frozen-lockfile
    build-command: pnpm build
    serve-command: pnpm start
  ```

- **`dark-mode-toggle-label`** — If your site has a dark mode toggle, pass the accessible label (or a substring). The action will capture both light and dark variants. Omit this input to capture light mode only.

The dark-mode toggle must be reachable via `getByRole("button", { name: /label/i })`. For example, if your toggle has `aria-label="Toggle dark mode"`, pass `"toggle dark mode"` or just `"dark mode"`.

## How sections are captured

Screenshots are captured at 1280x800. When `dark-mode-toggle-label` is set, the
action clicks the button matching that label and captures a second dark-mode
variant for each section.

The dark-mode toggle button must be reachable via `getByRole("button", { name })`.
Ensure your toggle has an accessible label that matches the value you pass in.

## How images are hosted

All images are uploaded to GitHub's user-attachments API
(`uploads.github.com/repos/{owner}/{repo}/issues/{pr}/assets`). They are
hosted permanently on GitHub's CDN — no screenshots branch or artifact storage
needed.
