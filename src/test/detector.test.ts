import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectProject } from '../deploy/detector';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'samosa-test-'));
}

suite('detectProject', () => {
  test('detects Node.js project', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'my-app', scripts: { start: 'node index.js', build: 'tsc' } }));
    const info = detectProject(dir);
    assert.strictEqual(info.type, 'node');
    assert.strictEqual(info.name, 'my-app');
    assert.ok(info.buildCommand.includes('npm'));
    fs.rmSync(dir, { recursive: true });
  });

  test('detects Python project', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'flask\n');
    const info = detectProject(dir);
    assert.strictEqual(info.type, 'python');
    fs.rmSync(dir, { recursive: true });
  });

  test('detects Go project', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/app\ngo 1.21\n');
    const info = detectProject(dir);
    assert.strictEqual(info.type, 'go');
    fs.rmSync(dir, { recursive: true });
  });

  test('detects Docker project', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'Dockerfile'), 'FROM node:20\n');
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    const info = detectProject(dir);
    assert.strictEqual(info.type, 'docker'); // Dockerfile takes priority
    fs.rmSync(dir, { recursive: true });
  });

  test('returns unknown for unrecognised project', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'README.md'), '# hello');
    const info = detectProject(dir);
    assert.strictEqual(info.type, 'unknown');
    fs.rmSync(dir, { recursive: true });
  });

  test('sanitizes project name', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'My Cool App!' }));
    const info = detectProject(dir);
    assert.match(info.name, /^[a-z0-9-]+$/);
    fs.rmSync(dir, { recursive: true });
  });
});
