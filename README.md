# Samosa v1.0.0

Deploy any project to [Render](https://render.com) with a single click from VS Code.

## Features

- One-click deploy from the activity bar
- Auto-detects React, Node.js, Python, Go and static sites
- Pre-flight checks catch common deployment issues before they fail
- Generates `render.yaml`, patches `requirements.txt` and creates `Procfile` as needed
- Reads `.env` and syncs environment variables to Render
- Initialises a git repo, creates a GitHub repo, commits and pushes automatically
- All UI in the sidebar — no popups

## Requirements

- A [GitHub](https://github.com) account
- A [Render](https://render.com) account with an API key
- Render connected to GitHub (one-time setup via the Render dashboard)

## Installation

Install Samosa in any of the following ways:

- **VS Code Marketplace** — search for *Samosa* in the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`) and click **Install**, or go [here](https://marketplace.visualstudio.com/items?itemName=majackie.samosa)
- **Release download** — grab the latest `.vsix` from the [Releases page](https://github.com/majackie/samosa/releases/tag/v1.0.0) and run **Extensions: Install from VSIX…**

## Setup

1. Install the extension using one of the methods above
2. Click the samosa icon in the activity bar
3. Click **Connect** next to GitHub and sign in via VS Code's native auth
4. Click **Connect** next to Render and paste your API key (Dashboard → Account Settings → API Keys)
5. Connect Render to GitHub once at [dashboard.render.com/select-repo](https://dashboard.render.com/select-repo?type=web)

## Deploy

1. Open your project folder in VS Code
2. Click **Deploy to Render**
3. Review any pre-flight warnings and confirm
4. Enter a commit message if there are uncommitted changes
5. Watch the 5-step progress: detect → scaffold → commit → push → deploy
6. Click **Open in Browser** when done

On first deploy the plan picker appears — select **Free** and it is remembered for future deploys.

## Supported stacks

| Stack | Detection | Build | Start |
|-------|-----------|-------|-------|
| Static / Vanilla | `index.html`, no server entry | `npm run build` if available | — |
| Node.js | `package.json` | `npm install` | `npm start` |
| Python / Flask | `requirements.txt` / `Pipfile` / `pyproject.toml` | `pip install -r requirements.txt` | `gunicorn <entry>:app` |
| Go | `go.mod` | `go build -o app .` | `./app` |
| React SPA | `react` in deps, no server framework | `npm install && npm run build` | — |
| React + Node monorepo | `client/package.json` + `server/package.json` | installs root, server and client; builds client | `node server/<entry>` |

If detection fails, a manual type picker appears in the sidebar.

## Pre-flight checks

Samosa scans for issues before deploying and shows a warnings screen if any are found:

- **No `process.env.PORT`** — Node servers must listen on `PORT` env var

Choose **Deploy anyway** to proceed or **Cancel** to fix the issue first.

## Commands

| Command | Description |
|---------|-------------|
| `Samosa: Deploy to Render` | Run the full deploy flow |
| `Samosa: Disconnect Render Account` | Clear the stored Render API key |

---

## Development

```bash
npm run build    # bundle with esbuild → dist/extension.js
npm run watch    # rebuild on file changes
npm run package  # build + vsce package → .vsix
npm test         # run tests
```

Press `F5` in VS Code to launch the extension debug host.

### Source layout

```
src/
├── extension.ts           # activate(), runDeploy() — orchestrates the full flow
├── auth/
│   ├── github.ts          # getGitHubSession(mode), getGitHubToken()
│   └── render.ts          # validateAndSaveRenderApiKey(), getRenderApiKey(), clearRenderApiKey()
├── deploy/
│   ├── detector.ts        # detectProject() → ProjectInfo
│   ├── projectTypes.ts    # PROJECT_TYPES — shared source of truth for all project type metadata
│   ├── scaffolder.ts      # scaffoldForDeploy() → render.yaml, Procfile, requirements.txt
│   ├── checker.ts         # checkForIssues() → DeployIssue[] pre-flight checks
│   └── renderApi.ts       # RenderClient: getOwnerId, findOrCreateService, triggerDeploy
├── github/
│   └── index.ts           # ensureGitHubRepo(), pushToGitHub(), getUncommittedFiles(), stageAndCommit()
└── ui/
    └── sidebarView.ts     # SamosaSidebarProvider: _css()/_html()/_script(), ask() for async prompts
```

### Sidebar screens

| Screen | Purpose |
|--------|---------|
| `idle` | GitHub / Render connection status + Deploy button |
| `render-key` | API key input |
| `progress` | 5-step deploy progress |
| `pick-project-type` | Manual type picker when detection fails |
| `pick-plan` | Render plan selector (shown on 402, cached in `globalState`) |
| `ask-commit` | Commit message input |
| `warnings` | Pre-flight issues with Deploy anyway / Cancel |
| `success` | Deployed URL + Open / Dashboard buttons |
| `error` | Error message + optional action button |

### Key design decisions

- **GitHub auth:** `getGitHubSession(mode)` with `mode: 'silent' | 'create' | 'force'` maps to VS Code's `createIfNone` / `forceNewSession` options.
- **Render auth:** API key validated against `GET /owners` and stored in `vscode.SecretStorage`.
- **render.yaml:** Always regenerated on deploy and content-diffed to avoid spurious commits. Committed to repo so Render uses it as IaC.
- **Deploy = push:** Render auto-deploys on push via webhook. `triggerDeploy()` is only called for services that already existed.
- **Render plan:** Defaults to `free`. On 402 the sidebar prompts for a plan once and caches the choice in `context.globalState`.
- **`envSpecificDetails`:** `buildCommand` and `startCommand` must be nested inside `envSpecificDetails` in the Render API payload.
- **Project types:** Defined once in `projectTypes.ts` and imported by both `extension.ts` and `sidebarView.ts`.

### Error types

- `RenderGitHubAccessError` — 400 from Render: GitHub App not installed or authorized
- `RenderPaymentError` — 402 from Render: plan requires payment; triggers plan picker and retry
