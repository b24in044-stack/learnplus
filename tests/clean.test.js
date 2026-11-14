import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('clean script removes only dist on Windows-compatible Node APIs', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'student-agent-clean-'));
  try {
    await mkdir(path.join(tempDirectory, 'dist'));
    await mkdir(path.join(tempDirectory, 'src'));
    await writeFile(path.join(tempDirectory, 'dist', 'bundle.js'), 'generated');
    await writeFile(path.join(tempDirectory, 'src', 'keep.ts'), 'source');
    await writeFile(path.join(tempDirectory, '.env'), 'KEEP_ME=true');

    const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'clean.js')], {
      cwd: tempDirectory,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(readFile(path.join(tempDirectory, 'dist', 'bundle.js')));
    assert.equal(await readFile(path.join(tempDirectory, 'src', 'keep.ts'), 'utf8'), 'source');
    assert.equal(await readFile(path.join(tempDirectory, '.env'), 'utf8'), 'KEEP_ME=true');
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
