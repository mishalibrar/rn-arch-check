import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import test from 'node:test';

import { STATUS, checkDependencies, checkPackage } from '../lib/checker.js';
import { allLookupsFailed, formatReport } from '../lib/report.js';
import { ScanError, scanProject } from '../lib/scanner.js';

async function tempProject(manifest) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rn-arch-edge-'));
  await writeFile(
    path.join(dir, 'package.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
  );
  return dir;
}

test('valid JSON that is not an object is rejected cleanly', async () => {
  for (const body of ['null', '["a","b"]', '"a string"', '42']) {
    const dir = await tempProject(body);
    await assert.rejects(() => scanProject(dir), (error) => {
      assert.ok(error instanceof ScanError, `${body} should raise a ScanError`);
      assert.match(error.message, /does not contain a JSON object/);
      return true;
    });
  }
});

test('accepts a path to the package.json file itself', async () => {
  const dir = await tempProject({ name: 'direct', dependencies: { 'react-native': '0.76.0' } });

  const project = await scanProject(path.join(dir, 'package.json'));

  assert.equal(project.projectName, 'direct');
  assert.equal(project.projectPath, dir);
});

test('a path to some other file explains itself', async () => {
  const dir = await tempProject({ name: 'x' });
  const other = path.join(dir, 'README.md');
  await writeFile(other, '# hi');

  await assert.rejects(() => scanProject(other), (error) => {
    assert.ok(error instanceof ScanError);
    assert.match(error.message, /is not a directory/);
    return true;
  });
});

test('a path that does not exist explains itself', async () => {
  await assert.rejects(() => scanProject('/definitely/not/here'), (error) => {
    assert.ok(error instanceof ScanError);
    assert.match(error.message, /No such file or directory/);
    return true;
  });
});

test('an Expo project counts as React Native even without a react-native dep', async () => {
  const dir = await tempProject({
    name: 'expo-app',
    dependencies: { expo: '~52.0.0', 'expo-router': '~4.0.0' },
  });

  const project = await scanProject(dir);

  assert.equal(project.isReactNative, true, 'expo alone should not warn');
  assert.equal(project.expoVersion, '~52.0.0');
  assert.equal(project.rnVersion, null);
});

test('a plain web project is still flagged as not React Native', async () => {
  const dir = await tempProject({ name: 'web', dependencies: { lodash: '^4.17.21' } });

  const project = await scanProject(dir);

  assert.equal(project.isReactNative, false);
});

test('non-string dependency versions do not break the scan', async () => {
  const dir = await tempProject({
    name: 'weird',
    dependencies: { 'react-native': '0.76.0', 'react-native-screens': null },
  });

  const project = await scanProject(dir);

  assert.deepEqual(
    project.dependencies.map((d) => d.name),
    ['react-native-screens'],
  );
});

test('a transient failure is retried and can then succeed', async () => {
  let attempts = 0;
  const result = await checkPackage(
    { name: 'flaky', version: '^1.0.0' },
    {
      retryDelayMs: 1,
      fetchImpl: async (url) => {
        attempts++;
        if (attempts < 3) throw new Error('fetch failed');
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            libraries: [{ npmPkg: url.searchParams.get('search'), newArchitecture: true }],
          }),
        };
      },
    },
  );

  assert.equal(result.status, STATUS.COMPATIBLE);
  assert.equal(attempts, 3);
});

test('retries are bounded, and exhaustion yields unknown', async () => {
  let attempts = 0;
  const result = await checkPackage(
    { name: 'always-down', version: '^1.0.0' },
    {
      retries: 2,
      retryDelayMs: 1,
      fetchImpl: async () => {
        attempts++;
        throw new Error('fetch failed');
      },
    },
  );

  assert.equal(result.status, STATUS.UNKNOWN);
  assert.equal(attempts, 3, 'one initial attempt plus two retries');
});

test('a 404-style response is not retried', async () => {
  let attempts = 0;
  await checkPackage(
    { name: 'gone', version: '^1.0.0' },
    {
      retries: 3,
      retryDelayMs: 1,
      fetchImpl: async () => {
        attempts++;
        return { ok: false, status: 400, statusText: 'Bad Request', json: async () => ({}) };
      },
    },
  );

  assert.equal(attempts, 1, 'client errors should fail fast');
});

test('a 429 is retried', async () => {
  let attempts = 0;
  await checkPackage(
    { name: 'busy', version: '^1.0.0' },
    {
      retries: 2,
      retryDelayMs: 1,
      fetchImpl: async () => {
        attempts++;
        return { ok: false, status: 429, statusText: 'Too Many Requests', json: async () => ({}) };
      },
    },
  );

  assert.equal(attempts, 3);
});

test('allLookupsFailed distinguishes a total outage from partial failures', async () => {
  const unknown = (name) => ({ name, status: STATUS.UNKNOWN });

  assert.equal(allLookupsFailed([unknown('a'), unknown('b')]), true);
  assert.equal(allLookupsFailed([unknown('a'), { name: 'b', status: STATUS.COMPATIBLE }]), false);
  assert.equal(allLookupsFailed([]), false, 'nothing to check is not a failure');
});

test('a total outage reports itself distinctly', async () => {
  const results = await checkDependencies([{ name: 'a', version: '^1.0.0' }], {
    retries: 0,
    fetchImpl: async () => {
      throw new Error('ENOTFOUND');
    },
  });

  const text = formatReport({ projectName: 'app', rnVersion: '0.76.0', results });

  assert.match(text, /Every lookup failed/);
  assert.doesNotMatch(text, /Re-run to try them again/);
});

test('the report header shows the expo version when there is no react-native', () => {
  const text = formatReport({
    projectName: 'expo-app',
    rnVersion: null,
    expoVersion: '~52.0.0',
    results: [],
  });

  assert.match(text, /expo ~52\.0\.0/);
});
