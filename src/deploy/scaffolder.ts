import * as fs from 'fs';
import * as path from 'path';
import { ProjectInfo } from './detector';

export interface EnvVar { key: string; value: string; }
export interface ScaffoldResult { created: string[]; envVars: EnvVar[]; }

function writeIfAbsent(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

function appendIfMissing(filePath: string, line: string): boolean {
  const contents = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  if (contents.includes(line.trim())) return false;
  fs.appendFileSync(filePath, (contents.endsWith('\n') ? '' : '\n') + line + '\n', 'utf8');
  return true;
}

export function parseEnvFile(workspaceRoot: string): EnvVar[] {
  // Prefer .env, fall back to .env.example (values will be empty placeholders)
  const envPath = path.join(workspaceRoot, '.env');
  const examplePath = path.join(workspaceRoot, '.env.example');
  const filePath = fs.existsSync(envPath) ? envPath : fs.existsSync(examplePath) ? examplePath : null;
  if (!filePath) return [];

  const isExample = filePath === examplePath;
  const vars: EnvVar[] = [];

  for (const raw of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) vars.push({ key, value: isExample ? '' : value });
  }

  return vars;
}

function buildRenderYaml(info: ProjectInfo, envVarKeys: string[], workspaceRoot: string): string {
  if (info.type === 'static') {
    const hasBuild = !!info.buildCommand;
    // Detect common output dirs; fall back to repo root for plain HTML
    const publishPath = hasBuild
      ? (['dist', 'build', 'out', 'public'].find(d => fs.existsSync(path.join(workspaceRoot, d))) ?? 'dist')
      : '.';
    const lines = [
      `services:`,
      `  - type: web`,
      `    name: ${info.name}`,
      `    runtime: static`,
    ];
    if (hasBuild) lines.push(`    buildCommand: ${info.buildCommand}`);
    lines.push(`    staticPublishPath: ./${publishPath}`);
    lines.push(`    pullRequestPreviewsEnabled: true`);
    return lines.join('\n') + '\n';
  }

  const lines = [
    `services:`,
    `  - type: web`,
    `    name: ${info.name}`,
    `    runtime: ${info.runtime}`,
    `    plan: free`,
  ];

  if (info.buildCommand) lines.push(`    buildCommand: ${info.buildCommand}`);
  if (info.startCommand) lines.push(`    startCommand: ${info.startCommand}`);

  lines.push(`    pullRequestPreviewsEnabled: true`);

  // List env var keys with sync:false so Render knows they exist but values are set via dashboard/API
  const allKeys = [
    ...(info.type === 'node' ? [{ key: 'NODE_VERSION', value: '"20"', sync: true }] : []),
    ...(info.type === 'python' ? [{ key: 'PYTHON_VERSION', value: '"3.11"', sync: true }] : []),
    ...envVarKeys.map(k => ({ key: k, sync: false })),
  ];

  if (allKeys.length > 0) {
    lines.push(`    envVars:`);
    for (const v of allKeys) {
      if (v.sync === false) {
        lines.push(`      - key: ${v.key}`);
        lines.push(`        sync: false`);
      } else {
        lines.push(`      - key: ${v.key}`);
        lines.push(`        value: ${(v as { value: string }).value}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

export function scaffoldForDeploy(workspaceRoot: string, info: ProjectInfo): ScaffoldResult {
  const created: string[] = [];
  const envVars = parseEnvFile(workspaceRoot);

  // render.yaml — always regenerate so it stays in sync with the detected project type
  const renderYamlPath = path.join(workspaceRoot, 'render.yaml');
  const renderYamlContent = buildRenderYaml(info, envVars.map(v => v.key), workspaceRoot);
  const existingContent = fs.existsSync(renderYamlPath) ? fs.readFileSync(renderYamlPath, 'utf8') : '';
  if (existingContent !== renderYamlContent) {
    fs.writeFileSync(renderYamlPath, renderYamlContent, 'utf8');
    created.push(existingContent ? 'render.yaml (updated)' : 'render.yaml');
  }

  // Ensure render.yaml is not gitignored
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const contents = fs.readFileSync(gitignorePath, 'utf8');
    if (contents.split('\n').some(l => l.trim() === 'render.yaml')) {
      fs.writeFileSync(
        gitignorePath,
        contents.split('\n').filter(l => l.trim() !== 'render.yaml').join('\n'),
        'utf8'
      );
      created.push('.gitignore (un-ignored render.yaml)');
    }
  }

  if (info.type === 'node') {
    // Ensure .gitignore ignores node_modules
    if (writeIfAbsent(gitignorePath, 'node_modules/\n.env\ndist/\n')) {
      created.push('.gitignore');
    } else {
      if (appendIfMissing(gitignorePath, 'node_modules/')) created.push('.gitignore (added node_modules)');
    }
  }

  if (info.type === 'python') {
    // Add gunicorn to requirements if missing
    const reqPath = path.join(workspaceRoot, 'requirements.txt');
    if (!fs.existsSync(reqPath)) {
      fs.writeFileSync(reqPath, 'gunicorn\n', 'utf8');
      created.push('requirements.txt');
    } else if (appendIfMissing(reqPath, 'gunicorn')) {
      created.push('requirements.txt (added gunicorn)');
    }
    // Procfile
    if (writeIfAbsent(path.join(workspaceRoot, 'Procfile'), `web: ${info.startCommand}\n`)) {
      created.push('Procfile');
    }
  }

  return { created, envVars };
}
