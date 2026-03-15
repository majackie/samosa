import * as vscode from 'vscode';

const RENDER_API_KEY_SECRET = 'samosa.renderApiKey';
const RENDER_API_BASE = 'https://api.render.com/v1';

async function validateRenderApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${RENDER_API_BASE}/owners?limit=1`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getRenderApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(RENDER_API_KEY_SECRET);
}

/** Validate and persist a key supplied by the caller (no UI). */
export async function validateAndSaveRenderApiKey(secrets: vscode.SecretStorage, apiKey: string): Promise<boolean> {
  const trimmed = apiKey.trim();
  if (!trimmed) return false;
  const valid = await validateRenderApiKey(trimmed);
  if (!valid) return false;
  await secrets.store(RENDER_API_KEY_SECRET, trimmed);
  return true;
}

export async function clearRenderApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(RENDER_API_KEY_SECRET);
}
