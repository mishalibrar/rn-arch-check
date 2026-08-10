import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import test from 'node:test';

import { ScanError, scanProject } from '../lib/scanner.js';

const MOCK_PROJECT = fileURLToPath(new URL('./fixtures/mock-project', import.meta.url));

async function tempProject(manifest) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rn-arch-check-'));
  if (manifest !== undefined) {
    await writeFile(
      path.join(dir, 'package.json'),
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    );
  }
  return dir;
}

test('reads project identity and the react-native version', async () => {
  const project = await scanProject(MOCK_PROJECT);

  assert.equal(project.projectName, 'mock-rn-app');
  assert.equal(project.rnVersion, '0.76.0');
});

test('filters pure-JS packages out of the checklist', async () => {
  const project = await scanProject(MOCK_PROJECT);
  const names = project.dependencies.map((d) => d.name);

  assert.deepEqual(names, [
    '@react-native-community/checkbox',
    'react-native-gesture-handler',
    'react-native-screens',
    'react-native-track-player',
    'totally-not-a-real-package-xyz',
  ]);

  for (const skipped of ['lodash', 'zustand', 'dayjs', 'react', 'typescript', '@types/react']) {
    assert.ok(
      project.skipped.some((d) => d.name === skipped),
      `expected ${skipped} to be skipped`,
    );
  }
});

test('skips framework tooling, install-time tooling and itself', async () => {
  const noise = [
    'rn-arch-check',
    '@react-native/babel-preset',
    '@react-native/metro-config',
    '@react-native/virtualized-lists',
    '@react-native-community/cli',
    '@react-native-community/cli-platform-android',
    'd3-shape',
    'socket.io-client',
    'react-moment',
    'patch-package',
    'postinstall-postinstall',
  ];
  const dir = await tempProject({
    name: 'noisy',
    dependencies: Object.fromEntries([
      ['react-native', '0.77.0'],
      ['react-native-screens', '^4.0.0'],
      ...noise.map((n) => [n, '^1.0.0']),
    ]),
  });

  const project = await scanProject(dir);

  assert.deepEqual(
    project.dependencies.map((d) => d.name),
    ['react-native-screens'],
    'only the real native module should be checked',
  );
  for (const name of noise) {
    assert.ok(project.skipped.some((d) => d.name === name), `${name} should be skipped`);
  }
});

test('real @react-native-community native modules are still checked', async () => {
  // The CLI packages are skipped, but netinfo and friends must not be.
  const dir = await tempProject({
    name: 'community',
    dependencies: {
      'react-native': '0.77.0',
      '@react-native-community/netinfo': '^11.0.0',
      '@react-native-community/datetimepicker': '^8.0.0',
      '@react-native-community/cli': '^20.0.0',
    },
  });

  const project = await scanProject(dir);

  assert.deepEqual(
    project.dependencies.map((d) => d.name),
    ['@react-native-community/datetimepicker', '@react-native-community/netinfo'],
  );
});

test('scans devDependencies too — a native module there still ships', async () => {
  const dir = await tempProject({
    name: 'dev-deps',
    dependencies: { 'react-native': '0.76.0' },
    devDependencies: { 'react-native-mmkv': '^3.0.0' },
  });

  const project = await scanProject(dir);

  assert.deepEqual(
    project.dependencies.map((d) => d.name),
    ['react-native-mmkv'],
  );
});

test('keeps the declared version range with each package', async () => {
  const project = await scanProject(MOCK_PROJECT);
  const screens = project.dependencies.find((d) => d.name === 'react-native-screens');

  assert.equal(screens.version, '^4.0.0');
});

test('reports a null rnVersion for a non React Native project', async () => {
  const dir = await tempProject({ name: 'web-app', dependencies: { lodash: '^4.17.21' } });

  const project = await scanProject(dir);

  assert.equal(project.rnVersion, null);
  assert.deepEqual(project.dependencies, []);
});

test('falls back to the folder name when the manifest has none', async () => {
  const dir = await tempProject({ dependencies: {} });

  const project = await scanProject(dir);

  assert.equal(project.projectName, path.basename(dir));
});

test('missing package.json raises a ScanError with a hint', async () => {
  const dir = await tempProject();

  await assert.rejects(() => scanProject(dir), (error) => {
    assert.ok(error instanceof ScanError);
    assert.match(error.message, /No package.json found/);
    assert.match(error.hint, /--path/);
    return true;
  });
});

test('malformed package.json raises a ScanError', async () => {
  const dir = await tempProject('{ this is not json');

  await assert.rejects(() => scanProject(dir), ScanError);
});
