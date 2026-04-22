# screenshot-action

GitHub composite action for element-level PR screenshots with before/after diff.

Captures sections marked with `data-screenshot` attributes, compares them pixel-by-pixel against main-branch baselines, and injects a before/after table into the PR description. Only sections that actually changed appear — unchanged sections are silently skipped.

## How it works

```
┌─────────────────────────────────────────────────────────┐
│ On pull_request                                          │
│                                                          │
│  capture → diff against baselines → inject into PR      │
│                                                          │
│  Changed section: before/after table in PR description  │
│  New section (no baseline): single image labelled (new) │
│  Unchanged section: not shown                           │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ On push to main                                          │
│                                                          │
│  capture → store as new baselines                        │
└─────────────────────────────────────────────────────────┘
```

Baselines live on a `screenshots` branch at `main/{filename}`. Screenshots for each PR are stored at `screenshots/{pr-number}-{filename}` on the same branch.

## Usage

Mark any section worth reviewing with a `data-screenshot` attribute:

```tsx
<section data-screenshot="hero">...</section>
<section data-screenshot="projects">...</section>
```

Then add the action to your CI after your dev server is running:

```yaml
- name: Start dev server
  run: |
    pnpm build && pnpm start &
    until curl -sf http://localhost:3000; do sleep 1; done

- name: PR Screenshots
  uses: owenw2k/screenshot-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    pr-number: ${{ github.event.pull_request.number }}
```

Your CI job needs `contents: write` and `pull-requests: write` permissions:

```yaml
jobs:
  ci:
    permissions:
      contents: write
      pull-requests: write
```

The action handles all its own dependencies (Playwright, Pillow) for screenshot capture. No additional setup needed for the action itself.

> **If your repo runs Playwright e2e tests**, you must still install the Node Playwright browsers separately — the action installs its own Python Playwright build which is a different executable:
>
> ```yaml
> - name: Install Playwright browsers
>   run: pnpm exec playwright install --with-deps chromium
> ```
>
> Place this step before the action in your workflow. If you skip it, your e2e tests will fail with "Executable doesn't exist".

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | yes | | Token with `contents:write` and `pull-requests:write` |
| `pr-number` | no | `""` | PR number — required on `pull_request` events |
| `base-url` | no | `http://localhost:3000` | URL of the running server to screenshot |

## Setup: screenshots branch

Create an empty `screenshots` branch before first use:

```bash
git checkout --orphan screenshots
git rm -rf .
git commit --allow-empty -m "chore: init screenshots branch"
git push origin screenshots
git checkout main
```

## How sections are captured

Screenshots are captured in both light and dark mode at 1280×800. The dark mode capture clicks the button with the accessible label matching `switch to dark mode` — ensure your dark mode toggle has that label.
