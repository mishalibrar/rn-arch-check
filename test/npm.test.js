import assert from 'node:assert/strict';
import test from 'node:test';

import { STATUS, checkPackage } from '../lib/checker.js';
import { fetchDeprecation } from '../lib/npm.js';
import { buildJson, formatReport } from '../lib/report.js';

const ok = (body) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });

test('reads a deprecation message', async () => {
  const message = 'Maintenance mode - development moved to @kesha-antonov/react-native-chat';
  const result = await fetchDeprecation('react-native-gifted-chat', {
    fetchImpl: async () => ok({ version: '3.4.0', deprecated: message }),
  });

  assert.equal(result, message);
});

test('treats a bare true as deprecated', async () => {
  const result = await fetchDeprecation('old-lib', {
    fetchImpl: async () => ok({ version: '1.0.0', deprecated: true }),
  });

  assert.match(result, /deprecated/i);
});

test('a healthy package reports nothing', async () => {
  for (const body of [{ version: '1.0.0' }, { version: '1.0.0', deprecated: '' }]) {
    assert.equal(await fetchDeprecation('fine', { fetchImpl: async () => ok(body) }), null);
  }
});

test('hits the small /latest endpoint, and encodes scoped names', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return ok({ version: '1.0.0' });
  };

  await fetchDeprecation('react-native-screens', { fetchImpl });
  await fetchDeprecation('@react-native-firebase/app', { fetchImpl });

  assert.equal(urls[0], 'https://registry.npmjs.org/react-native-screens/latest');
  assert.equal(urls[1], 'https://registry.npmjs.org/@react-native-firebase%2Fapp/latest');
});

test('a 404 or a network failure never throws', async () => {
  const notFound = await fetchDeprecation('nope', {
    fetchImpl: async () => ({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) }),
  });
  const offline = await fetchDeprecation('nope', {
    fetchImpl: async () => {
      throw new Error('ENOTFOUND');
    },
  });

  assert.equal(notFound, null);
  assert.equal(offline, null);
});

test('a compatible package can still be flagged deprecated', async () => {
  const result = await checkPackage(
    { name: 'gifted', version: '^3.0.0' },
    {
      fetchImpl: async (url) => {
        // The npm lookup is a plain string URL; the directory lookup is a URL object.
        if (typeof url === 'string') return ok({ version: '3.4.0', deprecated: 'moved to elsewhere' });
        return ok({ libraries: [{ npmPkg: 'gifted', newArchitecture: true }] });
      },
    },
  );

  assert.equal(result.status, STATUS.COMPATIBLE);
  assert.equal(result.deprecated, 'moved to elsewhere');
});

test('a failing npm registry does not fail the directory check', async () => {
  const result = await checkPackage(
    { name: 'lib', version: '^1.0.0' },
    {
      fetchImpl: async (url) => {
        if (typeof url === 'string') throw new Error('npm is down');
        return ok({ libraries: [{ npmPkg: 'lib', newArchitecture: false }] });
      },
    },
  );

  assert.equal(result.status, STATUS.INCOMPATIBLE);
  assert.equal(result.deprecated, null);
});

test('checkDeprecation: false skips the npm request entirely', async () => {
  let npmCalls = 0;
  const result = await checkPackage(
    { name: 'lib', version: '^1.0.0' },
    {
      checkDeprecation: false,
      fetchImpl: async (url) => {
        if (typeof url === 'string') {
          npmCalls++;
          return ok({ version: '1.0.0' });
        }
        return ok({ libraries: [{ npmPkg: 'lib', newArchitecture: true }] });
      },
    },
  );

  assert.equal(npmCalls, 0);
  assert.equal(result.deprecated, null);
});

test('the report prints the deprecation notice verbatim', () => {
  const results = [
    {
      name: 'react-native-gifted-chat',
      version: '^3.4.0',
      status: STATUS.COMPATIBLE,
      newArchOnly: false,
      unmaintained: true,
      deprecated: 'Maintenance mode - development moved to @kesha-antonov/react-native-chat',
      url: 'https://reactnative.directory/?search=react-native-gifted-chat',
    },
  ];

  const text = formatReport({ projectName: 'app', rnVersion: '0.77.0', results });

  assert.match(text, /Deprecated on npm \(1 package\)/);
  assert.match(text, /development moved to @kesha-antonov\/react-native-chat/);
  // Notes share one parenthesised group, deprecation first.
  assert.match(text, /\(deprecated, unmaintained\)/);
});

test('deprecation reaches the JSON output', () => {
  const payload = buildJson({
    projectName: 'app',
    rnVersion: '0.77.0',
    results: [
      {
        name: 'x',
        version: '^1.0.0',
        status: STATUS.COMPATIBLE,
        newArchOnly: false,
        unmaintained: false,
        deprecated: 'use y instead',
        url: 'u',
      },
      {
        name: 'y',
        version: '^1.0.0',
        status: STATUS.COMPATIBLE,
        newArchOnly: false,
        unmaintained: false,
        url: 'u',
      },
    ],
  });

  assert.equal(payload.results[0].deprecated, 'use y instead');
  assert.equal(payload.results[1].deprecated, null, 'absent should serialise as null, not undefined');
});
