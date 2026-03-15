import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';

function exec(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function isGitRepo(dir: string): boolean {
  try {
    exec('git rev-parse --is-inside-work-tree', dir);
    return true;
  } catch {
    return false;
  }
}

function getRemoteUrl(dir: string): string | null {
  try {
    return exec('git remote get-url origin', dir);
  } catch {
    return null;
  }
}

function hasCommits(dir: string): boolean {
  try {
    exec('git log -1 --oneline', dir);
    return true;
  } catch {
    return false;
  }
}

/** Converts SSH remote to HTTPS clone URL for Render's webhook. */
function toHttpsUrl(remoteUrl: string): string {
  // git@github.com:user/repo.git → https://github.com/user/repo.git
  const sshMatch = remoteUrl.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}.git`;
  }
  // Strip embedded credentials from HTTPS URL before returning to Render
  return remoteUrl.replace(/https:\/\/[^@]+@/, 'https://');
}

function isSSHRemote(url: string): boolean {
  return url.startsWith('git@');
}

/**
 * Ensures a GitHub remote exists for the workspace.
 * Returns a clean HTTPS clone URL (safe to pass to Render).
 */
export async function ensureGitHubRepo(
  workspaceRoot: string,
  token: string,
  repoName: string
): Promise<string> {
  const octokit = new Octokit({ auth: token });

  // Init git if needed
  if (!isGitRepo(workspaceRoot)) {
    exec('git init', workspaceRoot);
    exec('git checkout -b main', workspaceRoot);
  }

  // If a GitHub remote already exists, use it
  const existingRemote = getRemoteUrl(workspaceRoot);
  if (existingRemote && existingRemote.includes('github.com')) {
    return toHttpsUrl(existingRemote);
  }

  // No remote — create a GitHub repo and add it
  const { data: user } = await octokit.rest.users.getAuthenticated();

  let repoUrl: string;
  try {
    const { data: repo } = await octokit.rest.repos.get({ owner: user.login, repo: repoName });
    repoUrl = repo.clone_url;
  } catch {
    const { data: repo } = await octokit.rest.repos.createForAuthenticatedUser({
      name: repoName,
      private: false,
      auto_init: false,
    });
    repoUrl = repo.clone_url;
  }

  // Add remote with token embedded for the initial push; Render gets the clean URL
  const authedUrl = repoUrl.replace('https://', `https://${token}@`);
  exec(`git remote add origin ${authedUrl}`, workspaceRoot);

  return repoUrl; // clean HTTPS, no token
}

/** Returns changed/untracked files and whether the repo has any commits yet. */
export function getUncommittedFiles(workspaceRoot: string): { files: string[]; isFirstCommit: boolean } {
  if (!isGitRepo(workspaceRoot)) return { files: [], isFirstCommit: true };
  const isFirstCommit = !hasCommits(workspaceRoot);
  const raw = exec('git status --porcelain', workspaceRoot);
  const files = raw.length > 0 ? raw.split('\n').map(l => l.slice(3).trim()).filter(Boolean) : [];
  return { files, isFirstCommit };
}

/** Stages all changes and commits with the given message. */
export function stageAndCommit(workspaceRoot: string, message: string): void {
  exec('git add .', workspaceRoot);
  exec(`git commit -m ${JSON.stringify(message)}`, workspaceRoot);
}

/**
 * Pushes HEAD to origin.
 * Handles HTTPS remotes (embeds token) and SSH remotes (uses existing SSH key).
 */
export async function pushToGitHub(workspaceRoot: string, token: string): Promise<void> {

  const branch = (() => {
    try { return exec('git rev-parse --abbrev-ref HEAD', workspaceRoot); }
    catch { return 'main'; }
  })();

  const remoteUrl = getRemoteUrl(workspaceRoot) ?? '';

  if (isSSHRemote(remoteUrl)) {
    // SSH — rely on the user's existing SSH key
    exec(`git push origin ${branch}`, workspaceRoot);
  } else {
    // HTTPS — embed token so the push is authenticated
    const authedUrl = remoteUrl.includes('@')
      ? remoteUrl // already has credentials (set during ensureGitHubRepo for new repos)
      : remoteUrl.replace('https://', `https://${token}@`);
    exec(`git push ${authedUrl} HEAD:${branch}`, workspaceRoot);
  }
}
