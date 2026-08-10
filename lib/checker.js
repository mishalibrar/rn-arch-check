export const API_URL = 'https://reactnative.directory/api/libraries';

export const STATUS = {
  COMPATIBLE: 'compatible',
  INCOMPATIBLE: 'incompatible',
  UNVERIFIED: 'unverified',
  UNLISTED: 'unlisted',
  UNKNOWN: 'unknown',
};

export const DEFAULT_CONCURRENCY = 5;

/** Link a human can open to read the directory entry themselves. */
export function directoryUrl(name) {
  return `https://reactnative.directory/?search=${encodeURIComponent(name)}`;
}

/**
 * Query the directory for one package.
 *
 * The search response only carries a `newArchitecture` field for some entries —
 * plenty of confirmed-supported libraries (react-native-screens among them)
 * omit it entirely. The `newArchitecture=true` filter is authoritative in those
 * cases, so an entry with no field gets one extra, narrower request rather than
 * being written off as unverified.
 */
async function searchDirectory(name, { fetchImpl, timeoutMs, filter }) {
  const url = new URL(API_URL);
  url.searchParams.set('search', name);
  if (filter !== undefined) url.searchParams.set('newArchitecture', filter);

  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`directory responded ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const libraries = Array.isArray(data?.libraries) ? data.libraries : [];
  // The search is fuzzy — "react-native-screens" also returns
  // "react-native-screenshot-aware". Only an exact npm name counts.
  return libraries.find((library) => library.npmPkg === name) ?? null;
}

/** Classify a single dependency. Never throws; failures become "unknown". */
export async function checkPackage(dependency, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    timeoutMs = 15_000,
  } = options;

  const { name, version } = dependency;
  const base = { name, version, url: directoryUrl(name) };

  try {
    const entry = await searchDirectory(name, { fetchImpl, timeoutMs });

    if (!entry) {
      return { ...base, status: STATUS.UNLISTED, unmaintained: false, newArchOnly: false };
    }

    const unmaintained = Boolean(entry.unmaintained);
    const flag = entry.newArchitecture;

    if (flag === false) {
      return { ...base, status: STATUS.INCOMPATIBLE, unmaintained, newArchOnly: false };
    }
    if (flag === true) {
      return { ...base, status: STATUS.COMPATIBLE, unmaintained, newArchOnly: false };
    }
    if (flag === 'new-arch-only') {
      return { ...base, status: STATUS.COMPATIBLE, unmaintained, newArchOnly: true };
    }

    // Field absent: ask the filtered endpoint whether the directory considers
    // this package New Architecture ready.
    const confirmed = await searchDirectory(name, { fetchImpl, timeoutMs, filter: 'true' });
    return {
      ...base,
      status: confirmed ? STATUS.COMPATIBLE : STATUS.UNVERIFIED,
      unmaintained,
      newArchOnly: false,
    };
  } catch (error) {
    // One bad lookup must not sink the scan.
    return {
      ...base,
      status: STATUS.UNKNOWN,
      unmaintained: false,
      newArchOnly: false,
      error: error.message,
    };
  }
}

/**
 * Check every dependency, running at most `concurrency` lookups at a time so a
 * large project doesn't hammer the directory. Results keep the input order.
 */
export async function checkDependencies(dependencies, options = {}) {
  const { concurrency = DEFAULT_CONCURRENCY, onProgress, ...rest } = options;

  const results = new Array(dependencies.length);
  let cursor = 0;
  let done = 0;

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, dependencies.length)) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= dependencies.length) return;
        results[index] = await checkPackage(dependencies[index], rest);
        done++;
        onProgress?.(done, dependencies.length, dependencies[index].name);
      }
    },
  );

  await Promise.all(workers);
  return results;
}
