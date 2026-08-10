#!/usr/bin/env node
import { createRequire } from 'node:module';

import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';

import { DEFAULT_CONCURRENCY, checkDependencies } from '../lib/checker.js';
import { allLookupsFailed, buildJson, hasIncompatible, printReport } from '../lib/report.js';
import { ScanError, scanProject } from '../lib/scanner.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const EXIT_INCOMPATIBLE = 1;
const EXIT_ERROR = 2;

function parseConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ScanError(`--concurrency must be a positive integer, got "${value}"`);
  }
  return parsed;
}

const program = new Command();

program
  .name('rn-arch-check')
  .description(
    "Scan a React Native project's dependencies and report which ones are\n" +
      'compatible with the New Architecture (Fabric, TurboModules, JSI).',
  )
  .version(version, '-v, --version')
  // Resolved at run time rather than baked in, so --help doesn't print an
  // absolute path from whichever directory the package was built in.
  .option('-p, --path <path>', 'project root to scan (default: current directory)')
  .option('-c, --concurrency <number>', 'parallel lookups', parseConcurrency, DEFAULT_CONCURRENCY)
  .option('--json', 'raw JSON output instead of a formatted report', false)
  .action(main);

/** Anything written alongside JSON output goes to stderr, keeping stdout parseable. */
function warn(message) {
  process.stderr.write(`${message}\n`);
}

async function main(options) {
  const project = await scanProject(options.path ?? process.cwd());

  if (!project.isReactNative) {
    warn(
      chalk.yellow(
        `Warning: ${project.manifestPath} does not list react-native or expo as a dependency.\n` +
          'Scanning anyway.',
      ),
    );
  }

  // Silent unless we're on an interactive terminal, so piped and --json runs
  // stay free of progress noise.
  const spinner = ora({
    text: `Checking ${project.dependencies.length} packages…`,
    stream: process.stderr,
    isSilent: options.json || !process.stderr.isTTY,
  }).start();

  const results = await checkDependencies(project.dependencies, {
    concurrency: options.concurrency,
    onProgress: (done, total, name) => {
      spinner.text = `Checking ${done}/${total} — ${name}`;
    },
  });

  spinner.stop();

  if (options.json) {
    const payload = buildJson({
      projectName: project.projectName,
      rnVersion: project.rnVersion,
      results,
    });
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printReport({
      projectName: project.projectName,
      rnVersion: project.rnVersion,
      expoVersion: project.expoVersion,
      results,
      skipped: project.skipped,
    });
  }

  // A run where nothing could be reached must not look like a clean pass.
  if (allLookupsFailed(results)) {
    process.exitCode = EXIT_ERROR;
  } else if (hasIncompatible(results)) {
    process.exitCode = EXIT_INCOMPATIBLE;
  }
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof ScanError) {
    warn(chalk.red(error.message));
    if (error.hint) warn(error.hint);
  } else {
    warn(chalk.red(error.stack ?? error.message));
  }
  process.exitCode = EXIT_ERROR;
}
