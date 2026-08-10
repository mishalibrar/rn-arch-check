import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Raised for problems the user can fix (bad path, malformed manifest).
 * The CLI prints these without a stack trace.
 */
export class ScanError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'ScanError';
    this.hint = hint;
  }
}

/**
 * Packages that ship no native code, so the New Architecture cannot affect
 * them. Skipping these keeps the report focused and saves a lot of requests —
 * a typical app has far more pure-JS dependencies than native ones.
 */
const DENYLIST = new Set([
  // React / RN core (versioned by the framework itself, not the directory)
  'react',
  'react-dom',
  'react-native',
  'react-test-renderer',
  // Language + build tooling
  'typescript',
  'prettier',
  'eslint',
  'jest',
  'metro',
  'nodemon',
  'rimraf',
  'husky',
  'lint-staged',
  // Utilities
  'lodash',
  'lodash-es',
  'ramda',
  'dayjs',
  'date-fns',
  'moment',
  'uuid',
  'nanoid',
  'classnames',
  'clsx',
  'immer',
  'qs',
  'ms',
  // Data / state / validation
  'zustand',
  'redux',
  'react-redux',
  '@reduxjs/toolkit',
  'jotai',
  'recoil',
  'zod',
  'yup',
  'joi',
  'axios',
  'graphql',
  'i18next',
  'react-i18next',
  '@tanstack/react-query',
]);

/**
 * Prefixes for whole families of pure-JS packages. Kept deliberately short —
 * anything not matched here still gets looked up, so a false negative just
 * costs one request, while a false positive would hide a real native package.
 */
const DENY_PREFIXES = ['@types/', '@babel/', 'babel-', 'eslint-', 'jest-', '@testing-library/'];

function isPureJs(name) {
  return DENYLIST.has(name) || DENY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Read a project's package.json and work out which dependencies are worth
 * checking against the directory.
 *
 * Returns the project name, the declared react-native version (null when the
 * project doesn't depend on it), the packages to check, and the ones skipped.
 */
export async function scanProject(projectPath = process.cwd()) {
  const root = path.resolve(projectPath);
  const manifestPath = path.join(root, 'package.json');

  let raw;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new ScanError(
        `No package.json found at ${manifestPath}`,
        'Run this from your React Native project root, or pass --path <path>.',
      );
    }
    throw new ScanError(`Could not read ${manifestPath}: ${error.message}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new ScanError(`${manifestPath} is not valid JSON: ${error.message}`);
  }

  // Both sets are scanned: a native module in devDependencies still ends up in
  // the build, and plenty of projects put them there by accident.
  const declared = { ...manifest.dependencies, ...manifest.devDependencies };
  const allNames = Object.keys(declared).sort();

  const dependencies = [];
  const skipped = [];
  for (const name of allNames) {
    (isPureJs(name) ? skipped : dependencies).push({ name, version: declared[name] });
  }

  return {
    projectName: manifest.name || path.basename(root),
    projectPath: root,
    manifestPath,
    rnVersion: declared['react-native'] ?? null,
    dependencies,
    skipped,
  };
}
