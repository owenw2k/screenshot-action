# screenshot-action

GitHub composite action that captures element-level screenshots of your UI on every PR, diffs them pixel-by-pixel against the base branch, and injects a before/after table directly into the PR description.

Only sections that actually changed appear. Unchanged sections are silently skipped.

## What it looks like

When a PR changes a UI section, the action automatically updates the PR description with a table like this:

| | Before | After |
|---|---|---|
| Light | ![before light](https://example.com) | ![after light](https://example.com) |
| Dark | ![before dark](https://example.com) | ![after dark](https://example.com) |

New sections with no baseline are labelled **(new)**. Sections that did not change are not shown at all.

## How it works

```
On pull_request:

  1. Capture "after" screenshots from the already-running server
  2. Fetch base-ref and check it out in a temporary git worktree
  3. Install, build, and serve the base-ref on a side port
  4. Capture "before" screenshots from the base-ref server
  5. Pixel-diff each section (pixelmatch, threshold 0.1)
  6. Upload changed images to GitHub's CDN (permanent URLs)
  7. Inject before/after table into the PR description

If the base ref does not exist (first PR in a repo, or a brand-new branch),
the before step is skipped and all sections are marked as new.
On non-pull_request events the action exits immediately with no side effects.
```

## Quick start

**1. Mark sections worth reviewing:**

```tsx
<section data-screenshot="hero">...</section>
<nav data-screenshot="navigation">...</nav>
<footer data-screenshot="footer">...</footer>
```

**2. Add the action to your CI after starting the server:**

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write  # required to update PR description

    steps:
      - uses: actions/checkout@v4

      # ... install, lint, test, build steps ...

      - name: Start server
        run: |
          pnpm start &
          until curl -sf http://localhost:3000; do sleep 1; done

      - name: PR Screenshots
        uses: owenw2k/screenshot-action@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          pr-number: ${{ github.event.pull_request.number }}
          install-command: pnpm install --frozen-lockfile
          build-command: pnpm build
          serve-command: pnpm start

      - name: Stop server
        if: always()
        run: fuser -k 3000/tcp 2>/dev/null || true
```

That's it. The action is safe to leave in your CI unconditionally — it does nothing on push events.

## Dark mode

If your site has a dark mode toggle, pass its accessible label and the action captures both variants for every section:

```yaml
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

The label is matched case-insensitively against the toggle button's accessible name via `getByRole("button", { name: /label/i })`. Pass any substring — if your toggle has `aria-label="Switch to dark mode"`, passing `"dark mode"` works fine.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | yes | | Token with `pull-requests: write` |
| `pr-number` | no | `""` | Pass `${{ github.event.pull_request.number }}` |
| `base-url` | no | `http://localhost:3000` | URL of the running "after" server |
| `base-ref` | no | `main` | Branch or ref to compare against |
| `install-command` | no | `npm ci` | Install command for the base-ref worktree |
| `build-command` | no | `npm run build` | Build command for the base-ref worktree |
| `serve-command` | no | `npm start` | Serve command for the base-ref worktree |
| `dark-mode-toggle-label` | no | `""` | Accessible label of the dark-mode toggle. Omit to skip dark mode. |

**`base-ref`** defaults to `main`. If the ref does not exist the action skips gracefully — useful for first PRs or repos with a different default branch.

**`install-command` / `build-command` / `serve-command`** run inside a temporary git worktree checked out at `base-ref`. Override all three when not using npm:

```yaml
install-command: pnpm install --frozen-lockfile
build-command: pnpm build
serve-command: pnpm start
```

**`base-url`** only needs overriding if your server runs on a port other than 3000.

## Requirements

- The CI job must have `pull-requests: write` permission
- The server must be running and healthy before the action step
- Screenshots are captured at **1280x800** with Chromium
- The action installs its own Chromium — if your job also runs Playwright e2e tests, install browsers explicitly before the e2e step or they will fail with "Executable doesn't exist":

```yaml
- name: Install Playwright browsers
  run: pnpm exec playwright install --with-deps chromium

- name: Playwright tests
  run: pnpm test:e2e
```

## Versioning

Use `@v2` to always get the latest v2.x release. Use `@v2.1.0` to pin to a specific version.

The `v2` tag is a floating pointer updated automatically on every release — you never need to change your workflow YAML to receive patch and minor updates.
