import { readFile, stat } from 'node:fs/promises';
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
  // This tool itself, when installed as a devDependency of the project it scans.
  'rn-arch-check',
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
  'socket.io',
  'socket.io-client',
  'react-moment',
  // Install-time tooling, not part of the app bundle
  'patch-package',
  'postinstall-postinstall',
]);

/**
 * Prefixes for whole families of pure-JS packages. Kept deliberately short —
 * anything not matched here still gets looked up, so a false negative just
 * costs one request, while a false positive would hide a real native package.
 */
const DENY_PREFIXES = [
  '@types/',
  '@babel/',
  'babel-',
  'eslint-',
  'jest-',
  '@testing-library/',
  // React Native's own packages, versioned with the framework rather than
  // tracked individually: @react-native/babel-preset, metro-config,
  // virtualized-lists, and the community CLI. Note this deliberately does NOT
  // cover the rest of @react-native-community/*, which holds real native
  // modules like netinfo and datetimepicker.
  '@react-native/',
  '@react-native-community/cli',
  // d3-* are pure-JS data utilities
  'd3-',
];

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
  const target = path.resolve(projectPath);
  const { root, manifestPath } = await resolveManifestPath(target);

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

  // Valid JSON isn't necessarily a valid manifest — `null` and `[…]` both parse.
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new ScanError(`${manifestPath} does not contain a JSON object.`);
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

  const expoVersion = declared.expo ?? null;

  return {
    projectName: manifest.name || path.basename(root),
    projectPath: root,
    manifestPath,
    rnVersion: declared['react-native'] ?? null,
    expoVersion,
    // Expo projects are React Native projects even when they don't depend on
    // react-native directly, so they must not trigger the "not RN" warning.
    isReactNative: Boolean(declared['react-native'] || expoVersion),
    dependencies,
    skipped,
  };
}

/**
 * Accept either a project directory or a path to the package.json itself —
 * pointing at the file is a natural thing to try, and the resulting
 * "…/package.json/package.json" error is baffling.
 */
async function resolveManifestPath(target) {
  let stats;
  try {
    stats = await stat(target);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new ScanError(
        `No such file or directory: ${target}`,
        'Pass --path <path> pointing at your project root.',
      );
    }
    throw new ScanError(`Could not read ${target}: ${error.message}`);
  }

  if (stats.isDirectory()) {
    return { root: target, manifestPath: path.join(target, 'package.json') };
  }

  if (path.basename(target) === 'package.json') {
    return { root: path.dirname(target), manifestPath: target };
  }

  throw new ScanError(
    `${target} is not a directory.`,
    'Pass --path <path> pointing at your project root, or at its package.json.',
  );
}
