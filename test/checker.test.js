import assert from 'node:assert/strict';
import test from 'node:test';

import { STATUS, checkDependencies, checkPackage } from '../lib/checker.js';

/**
 * Stand-in for the directory. `entries` maps an npm name to the record the
 * search endpoint would return; `confirmed` lists names the newArchitecture=true
 * filter would match (which is how the real API answers for records that carry
 * no newArchitecture field of their own).
 */
function fakeDirectory({ entries = {}, confirmed = [], onRequest } = {}) {
  return async (url) => {
    const search = url.searchParams.get('search');
    const filter = url.searchParams.get('newArchitecture');
    onRequest?.(search, filter);

    let libraries = [];
    if (Object.hasOwn(entries, search)) {
      // The real search is fuzzy, so always include a near-miss to prove we
      // match on the exact npm name.
      libraries = [{ npmPkg: `${search}-lookalike`, newArchitecture: true }, { npmPkg: search, ...entries[search] }];
    }
    if (filter === 'true') {
      libraries = libraries.filter((l) => l.npmPkg !== search || confirmed.includes(search));
    }

    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ libraries }) };
  };
}

const dep = (name) => ({ name, version: '^1.0.0' });

test('classifies an explicit false as incompatible', async () => {
  const result = await checkPackage(dep('bad-lib'), {
    fetchImpl: fakeDirectory({ entries: { 'bad-lib': { newArchitecture: false } } }),
  });

  assert.equal(result.status, STATUS.INCOMPATIBLE);
  assert.equal(result.version, '^1.0.0');
  assert.match(result.url, /reactnative\.directory/);
});

test('classifies an explicit true as compatible', async () => {
  const result = await checkPackage(dep('good-lib'), {
    fetchImpl: fakeDirectory({ entries: { 'good-lib': { newArchitecture: true } } }),
  });

  assert.equal(result.status, STATUS.COMPATIBLE);
  assert.equal(result.newArchOnly, false);
});

test('flags new-arch-only packages as compatible but marked', async () => {
  const result = await checkPackage(dep('only-lib'), {
    fetchImpl: fakeDirectory({ entries: { 'only-lib': { newArchitecture: 'new-arch-only' } } }),
  });

  assert.equal(result.status, STATUS.COMPATIBLE);
  assert.equal(result.newArchOnly, true);
});

test('a missing field falls back to the filtered query — confirmed means compatible', async () => {
  const seen = [];
  const result = await checkPackage(dep('react-native-screens'), {
    fetchImpl: fakeDirectory({
      entries: { 'react-native-screens': {} },
      confirmed: ['react-native-screens'],
      onRequest: (search, filter) => seen.push(filter),
    }),
  });

  assert.equal(result.status, STATUS.COMPATIBLE);
  assert.deepEqual(seen, [null, 'true'], 'expected a plain search then a filtered one');
});

test('a missing field with no confirmation means unverified', async () => {
  const result = await checkPackage(dep('quiet-lib'), {
    fetchImpl: fakeDirectory({ entries: { 'quiet-lib': {} }, confirmed: [] }),
  });

  assert.equal(result.status, STATUS.UNVERIFIED);
});

test('a package the directory does not know is unlisted, and costs one request', async () => {
  let requests = 0;
  const result = await checkPackage(dep('totally-not-a-real-package-xyz'), {
    fetchImpl: fakeDirectory({ onRequest: () => requests++ }),
  });

  assert.equal(result.status, STATUS.UNLISTED);
  assert.equal(requests, 1);
});

test('fuzzy matches never count — only the exact npm name does', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ libraries: [{ npmPkg: 'react-native-screenshot-aware', newArchitecture: false }] }),
  });

  const result = await checkPackage(dep('react-native-screens'), { fetchImpl });

  assert.equal(result.status, STATUS.UNLISTED);
});

test('carries the unmaintained flag through', async () => {
  const result = await checkPackage(dep('old-lib'), {
    fetchImpl: fakeDirectory({
      entries: { 'old-lib': { newArchitecture: true, unmaintained: true } },
    }),
  });

  assert.equal(result.unmaintained, true);
});

test('a failed lookup becomes unknown instead of crashing the scan', async () => {
  const result = await checkPackage(dep('flaky-lib'), {
    fetchImpl: async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    },
  });

  assert.equal(result.status, STATUS.UNKNOWN);
  assert.match(result.error, /ENOTFOUND/);
});

test('an HTTP error becomes unknown', async () => {
  const result = await checkPackage(dep('rate-limited'), {
    fetchImpl: async () => ({ ok: false, status: 429, statusText: 'Too Many Requests', json: async () => ({}) }),
  });

  assert.equal(result.status, STATUS.UNKNOWN);
  assert.match(result.error, /429/);
});

test('one broken package does not stop the others', async () => {
  const deps = [dep('good-lib'), dep('explodes'), dep('bad-lib')];
  const base = fakeDirectory({
    entries: { 'good-lib': { newArchitecture: true }, 'bad-lib': { newArchitecture: false } },
  });

  const results = await checkDependencies(deps, {
    concurrency: 2,
    fetchImpl: async (url) => {
      if (url.searchParams.get('search') === 'explodes') throw new Error('boom');
      return base(url);
    },
  });

  assert.deepEqual(
    results.map((r) => r.status),
    [STATUS.COMPATIBLE, STATUS.UNKNOWN, STATUS.INCOMPATIBLE],
  );
});

test('never exceeds the concurrency cap against the directory, and keeps input order', async () => {
  const deps = Array.from({ length: 20 }, (_, i) => dep(`pkg-${i}`));
  // Each package also queries npm, on a different host. What must stay capped
  // is the load on the directory, which is the API that drops connections.
  const inFlight = { directory: 0, npm: 0 };
  const peak = { directory: 0, npm: 0 };

  const results = await checkDependencies(deps, {
    concurrency: 5,
    fetchImpl: async (url) => {
      const host = typeof url === 'string' ? 'npm' : 'directory';
      inFlight[host]++;
      peak[host] = Math.max(peak[host], inFlight[host]);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight[host]--;

      if (host === 'npm') {
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ version: '1.0.0' }) };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          libraries: [{ npmPkg: url.searchParams.get('search'), newArchitecture: true }],
        }),
      };
    },
  });

  assert.equal(peak.directory, 5, `expected 5 concurrent directory requests, saw ${peak.directory}`);
  assert.ok(peak.npm <= 5, `npm requests should also stay within the cap, saw ${peak.npm}`);
  assert.deepEqual(
    results.map((r) => r.name),
    deps.map((d) => d.name),
  );
});

test('reports progress once per package', async () => {
  const deps = [dep('a'), dep('b'), dep('c')];
  const seen = [];

  await checkDependencies(deps, {
    concurrency: 2,
    fetchImpl: fakeDirectory({ entries: {} }),
    onProgress: (done, total) => seen.push(`${done}/${total}`),
  });

  assert.deepEqual(seen, ['1/3', '2/3', '3/3']);
});

test('an empty dependency list makes no requests', async () => {
  let called = false;
  const results = await checkDependencies([], {
    fetchImpl: async () => {
      called = true;
      throw new Error('should not run');
    },
  });

  assert.deepEqual(results, []);
  assert.equal(called, false);
});
