import * as fs from 'fs';
import * as path from 'path';
import { ProjectInfo } from './detector';

export interface DeployIssue {
  message: string;
  severity: 'error' | 'warning';
}

function readFile(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}

/** Scan JS/TS files in a directory (non-recursive) for a string. */
function dirContains(dir: string, search: string): boolean {
  try {
    return fs.readdirSync(dir)
      .filter(f => /\.[jt]sx?$/.test(f))
      .some(f => readFile(path.join(dir, f)).includes(search));
  } catch { return false; }
}

export function checkForIssues(workspaceRoot: string, info: ProjectInfo): DeployIssue[] {
  const issues: DeployIssue[] = [];

  // ── PORT binding (Node services) ──────────────────────────────────────────
  if (info.type === 'node') {
    // For monorepo, check server/; for regular Node, check root + common entries
    const isMonorepo = fs.existsSync(path.join(workspaceRoot, 'server'));
    const searchDirs = isMonorepo
      ? [path.join(workspaceRoot, 'server')]
      : [workspaceRoot];

    const commonEntries = ['index.js', 'index.ts', 'app.js', 'app.ts', 'server.js', 'server.ts', 'main.js', 'main.ts'];

    const usesEnvPort = searchDirs.some(dir => {
      // Check named entry files first
      const inEntries = commonEntries.some(e => {
        const content = readFile(path.join(dir, e));
        return content.length > 0 && content.includes('process.env.PORT');
      });
      if (inEntries) return true;
      // Fall back to scanning all JS/TS files in that dir
      return dirContains(dir, 'process.env.PORT');
    });

    if (!usesEnvPort) {
      issues.push({
        message: 'Server may not listen on Render\'s PORT — use process.env.PORT (e.g. const PORT = process.env.PORT || 3000)',
        severity: 'error',
      });
    }
  }

  return issues;
}
