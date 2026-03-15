import * as fs from 'fs';
import * as path from 'path';

export type ProjectType = 'node' | 'python' | 'go' | 'static' | 'unknown';

export interface ProjectInfo {
  type: ProjectType;
  name: string;
  buildCommand: string;
  startCommand: string;
  runtime: string;
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const SERVER_FRAMEWORKS = ['express', 'fastify', 'koa', 'hapi', '@hapi/hapi', 'restify', 'feathers', '@nestjs/core'];

function exists(filePath: string): boolean {
  try { fs.accessSync(filePath); return true; } catch { return false; }
}

function readPackageJson(filePath: string): PackageJson {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PackageJson; } catch { return {}; }
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'my-app';
}

function hasDep(pkg: PackageJson, dep: string): boolean {
  return dep in (pkg.dependencies ?? {}) || dep in (pkg.devDependencies ?? {});
}

export function detectProject(workspaceRoot: string): ProjectInfo {
  const folderName = path.basename(workspaceRoot);
  const name = sanitizeName(folderName);

  // ── Node / JS ────────────────────────────────────────────────────────────
  if (exists(path.join(workspaceRoot, 'package.json'))) {
    const pkg = readPackageJson(path.join(workspaceRoot, 'package.json'));
    const projectName = sanitizeName(pkg.name ?? folderName);
    const scripts = pkg.scripts ?? {};
    const hasBuild = 'build' in scripts;
    const hasStart = 'start' in scripts;

    // Monorepo: client/ + server/ (e.g. React + Express)
    if (exists(path.join(workspaceRoot, 'client', 'package.json')) &&
        exists(path.join(workspaceRoot, 'server', 'package.json'))) {
      const serverEntry = ['index.js', 'app.js', 'server.js', 'main.js']
        .find(e => exists(path.join(workspaceRoot, 'server', e))) ?? 'index.js';
      const clientPkg = readPackageJson(path.join(workspaceRoot, 'client', 'package.json'));
      const clientHasBuild = 'build' in (clientPkg.scripts ?? {});
      return {
        type: 'node', name: projectName, runtime: 'node',
        buildCommand: clientHasBuild
          ? 'npm install && cd server && npm install && cd ../client && npm install && npm run build'
          : 'npm install && cd server && npm install',
        startCommand: `node server/${serverEntry}`,
      };
    }

    // React SPA (no server framework)
    if (hasDep(pkg, 'react') && !SERVER_FRAMEWORKS.some(f => hasDep(pkg, f))) {
      return {
        type: 'static', name: projectName, runtime: 'static',
        buildCommand: hasBuild ? 'npm install && npm run build' : '',
        startCommand: '',
      };
    }

    // Vanilla static
    if (exists(path.join(workspaceRoot, 'index.html')) && !hasStart &&
        !exists(path.join(workspaceRoot, 'server.js')) && !exists(path.join(workspaceRoot, 'app.js'))) {
      return {
        type: 'static', name: projectName, runtime: 'static',
        buildCommand: hasBuild ? 'npm install && npm run build' : '',
        startCommand: '',
      };
    }

    // Node.js
    return {
      type: 'node', name: projectName, runtime: 'node',
      buildCommand: hasBuild ? 'npm install && npm run build' : 'npm install',
      startCommand: hasStart ? 'npm start' : 'node index.js',
    };
  }

  // ── Python ───────────────────────────────────────────────────────────────
  if (['requirements.txt', 'Pipfile', 'pyproject.toml'].some(f => exists(path.join(workspaceRoot, f)))) {
    const buildCommand = exists(path.join(workspaceRoot, 'requirements.txt'))
      ? 'pip install -r requirements.txt' : 'pip install .';
    const entry = ['main.py', 'app.py', 'wsgi.py', 'server.py'].find(f => exists(path.join(workspaceRoot, f)));
    const startCommand = `gunicorn ${entry ? entry.replace('.py', '') : 'app'}:app`;
    return { type: 'python', name, buildCommand, startCommand, runtime: 'python' };
  }

  // ── Go ───────────────────────────────────────────────────────────────────
  if (exists(path.join(workspaceRoot, 'go.mod'))) {
    return { type: 'go', name, buildCommand: 'go build -o app .', startCommand: './app', runtime: 'go' };
  }

  return { type: 'unknown', name, buildCommand: '', startCommand: '', runtime: '' };
}
