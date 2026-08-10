import assert from 'node:assert/strict';
import test from 'node:test';

import { STATUS } from '../lib/checker.js';
import { buildJson, formatReport, hasIncompatible, summarize } from '../lib/report.js';

const result = (name, status, extra = {}) => ({
  name,
  version: '^1.0.0',
  status,
  newArchOnly: false,
  unmaintained: false,
  url: `https://reactnative.directory/?search=${name}`,
  ...extra,
});

const RESULTS = [
  result('aaa-fine', STATUS.COMPATIBLE),
  result('zzz-broken', STATUS.INCOMPATIBLE, { unmaintained: true }),
  result('mmm-maybe', STATUS.UNVERIFIED),
  result('unknown-lib', STATUS.UNLISTED),
  result('flaky-lib', STATUS.UNKNOWN, { error: 'ENOTFOUND' }),
];

test('counts every status', () => {
  const counts = summarize(RESULTS);

  assert.equal(counts.compatible, 1);
  assert.equal(counts.incompatible, 1);
  assert.equal(counts.unverified, 1);
  assert.equal(counts.unlisted, 1);
  assert.equal(counts.unknown, 1);
});

test('hasIncompatible drives the CI exit code', () => {
  assert.equal(hasIncompatible(RESULTS), true);
  assert.equal(hasIncompatible([result('fine', STATUS.COMPATIBLE)]), false);
  assert.equal(hasIncompatible([result('maybe', STATUS.UNVERIFIED)]), false);
});

test('prints incompatible packages first', () => {
  const text = formatReport({ projectName: 'my-app', rnVersion: '0.76.0', results: RESULTS });
  const lines = text.split('\n');

  const order = ['zzz-broken', 'mmm-maybe', 'aaa-fine', 'unknown-lib', 'flaky-lib'].map((name) =>
    lines.findIndex((line) => line.includes(name)),
  );

  assert.deepEqual([...order].sort((a, b) => a - b), order, 'rows should be severity ordered');
});

test('shows the project, the RN version, counts and the action message', () => {
  const text = formatReport({ projectName: 'my-app', rnVersion: '0.76.0', results: RESULTS });

  assert.match(text, /New Architecture Compatibility Report — my-app/);
  assert.match(text, /react-native 0\.76\.0/);
  assert.match(text, /1 incompatible/);
  assert.match(text, /Action needed/);
  assert.match(text, /unmaintained/);
  assert.match(text, /Some lookups failed/);
});

test('a clean project gets no action message', () => {
  const text = formatReport({
    projectName: 'clean-app',
    rnVersion: '0.76.0',
    results: [result('aaa-fine', STATUS.COMPATIBLE)],
  });

  assert.doesNotMatch(text, /Action needed/);
  assert.doesNotMatch(text, /Some lookups failed/);
});

test('marks New Arch only packages', () => {
  const text = formatReport({
    projectName: 'app',
    rnVersion: '0.76.0',
    results: [result('only-lib', STATUS.COMPATIBLE, { newArchOnly: true })],
  });

  assert.match(text, /New Arch only/);
});

test('mentions how many pure-JS packages were skipped', () => {
  const text = formatReport({
    projectName: 'app',
    rnVersion: '0.76.0',
    results: RESULTS,
    skipped: [{ name: 'lodash' }, { name: 'dayjs' }],
  });

  assert.match(text, /2 pure-JavaScript packages skipped/);
});

test('pluralises the skipped count correctly', () => {
  const text = formatReport({
    projectName: 'app',
    rnVersion: '0.76.0',
    results: RESULTS,
    skipped: [{ name: 'lodash' }],
  });

  assert.match(text, /1 pure-JavaScript package skipped/);
});

test('handles a project with no native dependencies', () => {
  const text = formatReport({ projectName: 'empty', rnVersion: null, results: [] });

  assert.match(text, /No native dependencies to check/);
});

test('builds the documented JSON shape', () => {
  const payload = buildJson({ projectName: 'my-app', rnVersion: '0.76.0', results: RESULTS });

  assert.deepEqual(Object.keys(payload), ['projectName', 'rnVersion', 'results']);
  assert.equal(payload.projectName, 'my-app');
  assert.equal(payload.rnVersion, '0.76.0');
  assert.equal(payload.results.length, 5);

  const broken = payload.results.find((r) => r.name === 'zzz-broken');
  assert.deepEqual(broken, {
    name: 'zzz-broken',
    version: '^1.0.0',
    status: 'incompatible',
    newArchOnly: false,
    unmaintained: true,
    deprecated: null,
    url: 'https://reactnative.directory/?search=zzz-broken',
  });

  const flaky = payload.results.find((r) => r.name === 'flaky-lib');
  assert.equal(flaky.error, 'ENOTFOUND');
});
