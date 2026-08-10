import chalk from 'chalk';

import { STATUS } from './checker.js';

/** Display metadata per status. Order here is the order rows are printed in. */
const STATUS_META = [
  { key: STATUS.INCOMPATIBLE, icon: '✘', label: 'Incompatible', color: chalk.red },
  { key: STATUS.UNVERIFIED, icon: '!', label: 'Unverified', color: chalk.yellow },
  { key: STATUS.COMPATIBLE, icon: '✔', label: 'Compatible', color: chalk.green },
  { key: STATUS.UNLISTED, icon: '?', label: 'Unlisted', color: chalk.gray },
  { key: STATUS.UNKNOWN, icon: '?', label: 'Unknown', color: chalk.gray },
];

const META_BY_KEY = Object.fromEntries(STATUS_META.map((meta) => [meta.key, meta]));
const MIN_WIDTH = 60;

/** Count results per status. */
export function summarize(results) {
  const counts = Object.fromEntries(STATUS_META.map((meta) => [meta.key, 0]));
  for (const result of results) counts[result.status]++;
  return counts;
}

export function hasIncompatible(results) {
  return results.some((result) => result.status === STATUS.INCOMPATIBLE);
}

/**
 * True when there were packages to check and every single lookup failed —
 * an offline or blocked run, where a clean exit code would be a lie.
 */
export function allLookupsFailed(results) {
  return results.length > 0 && results.every((result) => result.status === STATUS.UNKNOWN);
}

/** The `--json` payload. */
export function buildJson({ projectName, rnVersion, results }) {
  return {
    projectName,
    rnVersion,
    results: results.map((result) => ({
      name: result.name,
      version: result.version,
      status: result.status,
      newArchOnly: result.newArchOnly,
      unmaintained: result.unmaintained,
      deprecated: result.deprecated ?? null,
      url: result.url,
      ...(result.error ? { error: result.error } : {}),
    })),
  };
}

function sortResults(results) {
  const rank = (status) => STATUS_META.findIndex((meta) => meta.key === status);
  return [...results].sort(
    (a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name),
  );
}

/** Build the formatted terminal report as a string. */
export function formatReport({ projectName, rnVersion, expoVersion, results, skipped = [] }) {
  const rows = sortResults(results);
  const nameWidth = rows.reduce((max, row) => Math.max(max, row.name.length), 0);

  const lines = [];
  const heading = `New Architecture Compatibility Report — ${projectName}`;
  lines.push(chalk.bold(heading));
  const framework = [
    rnVersion ? `react-native ${rnVersion}` : null,
    expoVersion ? `expo ${expoVersion}` : null,
  ].filter(Boolean);
  if (framework.length) lines.push(chalk.gray(framework.join('  ·  ')));

  const body = rows.map((row) => {
    const meta = META_BY_KEY[row.status];
    // One parenthesised group, but "deprecated" is painted louder than the
    // rest: npm is actively telling you to move off the package, whatever its
    // compatibility status says.
    const notes = [];
    if (row.deprecated) notes.push(chalk.red('deprecated'));
    if (row.newArchOnly) notes.push(chalk.gray('New Arch only'));
    if (row.unmaintained) notes.push(chalk.gray('unmaintained'));
    if (row.error) notes.push(chalk.gray(row.error));
    const suffix = notes.length
      ? `${chalk.gray('  (')}${notes.join(chalk.gray(', '))}${chalk.gray(')')}`
      : '';
    return `${meta.color(meta.icon)}  ${row.name.padEnd(nameWidth)}  ${meta.color(meta.label)}${suffix}`;
  });

  const width = Math.max(MIN_WIDTH, heading.length, ...rows.map((r) => nameWidth + 20));
  const divider = chalk.gray('─'.repeat(width));

  lines.push(divider);
  lines.push(...(body.length ? body : [chalk.gray('No native dependencies to check.')]));
  lines.push(divider);

  const counts = summarize(results);
  const summary = STATUS_META.filter((meta) => counts[meta.key] > 0)
    .map((meta) => meta.color(`${counts[meta.key]} ${meta.label.toLowerCase()}`))
    .join(chalk.gray('  ·  '));
  lines.push(summary || chalk.gray('nothing to report'));

  if (skipped.length) {
    const noun = skipped.length === 1 ? 'package' : 'packages';
    lines.push(chalk.gray(`${skipped.length} pure-JavaScript ${noun} skipped.`));
  }

  if (allLookupsFailed(results)) {
    lines.push(
      '',
      chalk.yellow('Every lookup failed, so nothing could be verified.'),
      chalk.yellow('Check your network connection and try again.'),
    );
  } else if (counts[STATUS.UNKNOWN] > 0) {
    lines.push(
      '',
      chalk.yellow(
        'Some lookups failed, so those packages could not be checked.\nRe-run to try them again.',
      ),
    );
  }

  // A deprecation notice usually names the successor, so print it verbatim —
  // it is often the most actionable line in the whole report.
  const deprecated = results.filter((result) => result.deprecated);
  if (deprecated.length) {
    lines.push(
      '',
      chalk.red(
        `Deprecated on npm (${deprecated.length} ${deprecated.length === 1 ? 'package' : 'packages'}):`,
      ),
    );
    for (const result of deprecated) {
      lines.push(chalk.red(`  ${result.name}`), chalk.gray(`    ${result.deprecated}`));
    }
  }

  if (counts[STATUS.INCOMPATIBLE] > 0) {
    lines.push(
      '',
      chalk.red('Action needed: the packages above are confirmed incompatible.'),
      chalk.red('Check for a maintained fork, a New Architecture-ready alternative,'),
      chalk.red('or an open migration PR before upgrading.'),
    );
  }

  return lines.join('\n');
}

/** Print the formatted report to stdout. */
export function printReport(input, out = console) {
  out.log(formatReport(input));
}
