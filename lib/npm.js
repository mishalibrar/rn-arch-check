export const NPM_REGISTRY = 'https://registry.npmjs.org';

/**
 * Ask the npm registry whether a package is deprecated.
 *
 * The directory records New Architecture support but knows nothing about
 * deprecation, so a package can read "Compatible" while npm is actively telling
 * you to move off it — usually naming a successor in the notice.
 *
 * Uses the `/latest` endpoint, which returns a few kilobytes rather than the
 * full packument (hundreds of KB for a package with a long release history).
 *
 * Never throws: deprecation is extra context, never a reason to fail a scan.
 * A missing package, an offline registry or a malformed response all yield null.
 */
export async function fetchDeprecation(name, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    timeoutMs = 15_000,
    registry = NPM_REGISTRY,
  } = options;

  try {
    // Scoped names carry a slash that has to survive as a single path segment.
    const url = `${registry}/${name.replace('/', '%2F')}/latest`;
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    // 404 simply means npm has never heard of it — nothing to report.
    if (!response.ok) return null;

    const data = await response.json();
    const flag = data?.deprecated;

    // npm allows either a message or a bare `true`.
    if (typeof flag === 'string' && flag.trim()) return flag.trim();
    if (flag === true) return 'This package is deprecated.';
    return null;
  } catch {
    return null;
  }
}
