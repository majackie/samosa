import * as vscode from 'vscode';

const GITHUB_SCOPES = ['repo', 'user:email', 'read:user'];

type SessionMode = 'silent' | 'create' | 'force';

export async function getGitHubSession(mode: SessionMode = 'create'): Promise<vscode.AuthenticationSession | undefined> {
  const options =
    mode === 'silent' ? { createIfNone: false } :
    mode === 'force'  ? { forceNewSession: true } :
                        { createIfNone: true };
  try {
    return await vscode.authentication.getSession('github', GITHUB_SCOPES, options);
  } catch {
    return undefined;
  }
}

export async function getGitHubToken(): Promise<string | undefined> {
  return (await getGitHubSession('silent'))?.accessToken;
}
