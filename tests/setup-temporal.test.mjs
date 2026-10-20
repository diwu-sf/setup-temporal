import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { cacheIdentity, installCli } from '../lib/setup-temporal.js';

test('cache identity follows the resolved release, platform, and architecture', () => {
  const release = { archiveUrl: 'https://example.test/releases/v1.9.1/temporal.tar.gz', fileToExtract: 'temporal' };
  const nextRelease = { ...release, archiveUrl: 'https://example.test/releases/v1.9.2/temporal.tar.gz' };
  const key = cacheIdentity(release, 'linux', 'amd64');
  assert.equal(cacheIdentity({ ...release }, 'linux', 'amd64'), key);
  assert.notEqual(cacheIdentity(nextRelease, 'linux', 'amd64'), key);
  assert.notEqual(cacheIdentity(release, 'darwin', 'amd64'), key);
  assert.notEqual(cacheIdentity(release, 'linux', 'arm64'), key);
  assert.notEqual(cacheIdentity({ ...release, fileToExtract: 'temporal.exe' }, 'linux', 'amd64'), key);
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-temporal-test-'));
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'temporal'), 'downloaded CLI bytes');
  const archive = path.join(root, 'temporal.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', source, 'temporal']);
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push(request.url);
    if (request.url !== '/temporal.tar.gz') {
      response.writeHead(404).end();
      return;
    }
    response.end(await fs.readFile(archive));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previous = Object.fromEntries(['RUNNER_TEMP', 'GITHUB_PATH', 'PATH'].map((key) => [key, process.env[key]]));
  const runnerTemp = path.join(root, 'runner-temp');
  await fs.mkdir(runnerTemp);
  const githubPath = path.join(root, 'github-path');
  await fs.writeFile(githubPath, '');
  process.env.RUNNER_TEMP = runnerTemp;
  process.env.GITHUB_PATH = githubPath;
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    directory: path.join(root, 'CLI directory'),
    info: { archiveUrl: `http://127.0.0.1:${server.address().port}/temporal.tar.gz`, fileToExtract: 'temporal' },
    githubPath,
    runnerTemp,
    requests,
  };
}

test('a cache miss downloads, extracts, and exposes the CLI on PATH', async (t) => {
  const f = await fixture(t);
  await installCli(f.info, f.directory, false);
  assert.equal(await fs.readFile(path.join(f.directory, 'temporal'), 'utf8'), 'downloaded CLI bytes');
  assert.equal((await fs.stat(path.join(f.directory, 'temporal'))).mode & 0o111, 0o111);
  assert.equal((await fs.readFile(f.githubPath, 'utf8')).trim(), f.directory);
  assert.deepEqual(f.requests, ['/temporal.tar.gz']);
  assert.deepEqual(await fs.readdir(f.runnerTemp), []);
});

test('a cache hit uses the restored executable and adds it to PATH without downloading', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.directory);
  const binary = path.join(f.directory, 'temporal');
  await fs.writeFile(binary, 'restored CLI bytes', { mode: 0o755 });
  await installCli(f.info, f.directory, true);
  assert.equal(await fs.readFile(binary, 'utf8'), 'restored CLI bytes');
  assert.equal((await fs.readFile(f.githubPath, 'utf8')).trim(), f.directory);
  assert.deepEqual(f.requests, []);
});

test('a missing cached executable falls back to a fresh download', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.directory);
  await fs.writeFile(path.join(f.directory, 'partial'), 'incomplete restore');
  await installCli(f.info, f.directory, true);
  assert.deepEqual(await fs.readdir(f.directory), ['temporal']);
  assert.deepEqual(f.requests, ['/temporal.tar.gz']);
});

test('a cache miss replaces files left by an incomplete restore', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.directory);
  await fs.writeFile(path.join(f.directory, 'temporal'), 'stale CLI bytes', { mode: 0o755 });
  await installCli(f.info, f.directory, false);
  assert.equal(await fs.readFile(path.join(f.directory, 'temporal'), 'utf8'), 'downloaded CLI bytes');
  assert.deepEqual(f.requests, ['/temporal.tar.gz']);
});

test('a failed download fails setup and does not expose the directory on PATH', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    installCli({ ...f.info, archiveUrl: f.info.archiveUrl.replace('temporal.tar.gz', 'missing') }, f.directory, false),
  );
  assert.equal(await fs.readFile(f.githubPath, 'utf8'), '');
  assert.deepEqual(f.requests, ['/missing']);
});
