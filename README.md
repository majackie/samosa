# Samosa v1.0.0

Deploy any project to [Render](https://render.com) with a single click from VS Code.

## Features

- One-click deploy from the activity bar
- Auto-detects Static / Vanilla , Node.js, Python, Go and React
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

## Authour

- Jackie Ma
- Billy Nguyen
- Jonathan Lin