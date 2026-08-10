# rn-arch-check — check React Native New Architecture compatibility

[![CI](https://github.com/mishalibrar/rn-arch-check/actions/workflows/ci.yml/badge.svg)](https://github.com/mishalibrar/rn-arch-check/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/rn-arch-check)](https://www.npmjs.com/package/rn-arch-check)
[![node](https://img.shields.io/node/v/rn-arch-check)](https://www.npmjs.com/package/rn-arch-check)
[![license](https://img.shields.io/npm/l/rn-arch-check)](./LICENSE)

**rn-arch-check is a command-line tool that checks every dependency in a React
Native project against [React Native Directory](https://reactnative.directory)
and reports which ones support the New Architecture — Fabric, TurboModules and
JSI.** Find out before you migrate, not after your build breaks.

```bash
npx rn-arch-check
```

![rn-arch-check scanning a React Native project and reporting New Architecture compatibility for each dependency](https://raw.githubusercontent.com/mishalibrar/rn-arch-check/main/assets/demo.gif)

Every migration guide gives the same advice: open
[React Native Directory](https://reactnative.directory) and cross-reference it
against your `package.json` by hand. This does that for you in about two
seconds, for every dependency at once, and exits non-zero when something is
confirmed incompatible so it can gate CI.

The New Architecture is the default from React Native 0.76 and Expo SDK 52
onward, and the old architecture is on its way out — but plenty of third-party
packages still have no confirmed support. This tells you exactly which ones.

Pointed at a production app with 93 dependencies, it checked the 64 native ones
in about two seconds and found a single confirmed incompatibility — plus seven
packages reporting `Compatible` that had been abandoned for two to five years,
and one that npm had formally deprecated. [What a real scan turns
up](#what-a-real-scan-turns-up) has the full breakdown.

- **Zero config** — reads your `package.json`, no setup
- **Nothing to install** — runs straight from `npx`
- **CI-ready** — exit code `1` on a confirmed incompatibility
- **Deprecation-aware** — flags packages npm has deprecated, not just
  incompatible ones
- **Expo and bare React Native** — both supported

## Install

**Installing is optional, and usually not what you want.** Run it directly:

```bash
npx rn-arch-check
```

This is the recommended way. `npm install rn-arch-check` asks npm to re-resolve
your project's entire dependency tree, so it fails on any *pre-existing* peer
dependency conflict in your app — an error that looks like it came from this
tool but has nothing to do with it:

```
npm error ERESOLVE could not resolve
npm error Conflicting peer dependency: @react-native-masked-view/masked-view@0.2.9
```

`npx` sidesteps that entirely: it fetches the CLI into a temporary location
instead of merging it into your tree. The tool only ever *reads* your
`package.json`, so it never needs to be a dependency of your project.

If you do want it installed, prefer a global install, which is also isolated
from your project's tree:

```bash
npm install -g rn-arch-check
```

Adding it as a devDependency works too, but inherits the resolution problem
above and is only worth it if you want a committed `package.json` script:

```bash
npm install --save-dev rn-arch-check --legacy-peer-deps
```

Requires Node 18.17 or newer.

## Usage

```bash
# Run inside your React Native project root
rn-arch-check

# Or point at a project explicitly
rn-arch-check --path ./apps/mobile

# Raw JSON output, useful in CI
rn-arch-check --json

# Ease off the API on a very large project
rn-arch-check --concurrency 3
```

### Options

| Flag | Default | Meaning |
|---|---|---|
| `-p, --path <path>` | current directory | Project root to scan, or a path to its `package.json` |
| `-c, --concurrency <number>` | `5` | Parallel directory lookups |
| `--json` | off | Raw JSON output instead of the formatted report |
| `-v, --version` | | Print the version |
| `-h, --help` | | Print usage |

## Output

```
New Architecture Compatibility Report — big-rn-app
react-native 0.76.0
─────────────────────────────────────────────────────────────
✘  @react-native-community/checkbox           Incompatible
✘  react-native-track-player                  Incompatible
✔  @react-native-async-storage/async-storage  Compatible
✔  react-native-gesture-handler               Compatible
✔  react-native-reanimated                    Compatible
✔  react-native-screens                       Compatible
✔  react-native-snap-carousel                 Compatible  (unmaintained)
?  totally-not-a-real-package-xyz             Unlisted
─────────────────────────────────────────────────────────────
2 incompatible  ·  11 compatible  ·  2 unlisted
8 pure-JavaScript packages skipped.

Action needed: the packages above are confirmed incompatible.
Check for a maintained fork, a New Architecture-ready alternative,
or an open migration PR before upgrading.
```

Packages you need to act on are sorted to the top. Packages the directory flags
as `unmaintained`, or as requiring the New Architecture, are annotated in place.

### What a real scan turns up

Run against a production React Native app with 93 dependencies — 64 native
packages checked, 29 skipped as pure JavaScript — the result was 54 compatible,
8 unverified, 1 confirmed incompatible and 1 unlisted native module.

The single incompatible package was not the interesting finding. Seven
dependencies reported `Compatible` or `Unverified` while having been abandoned
for two to five years, and one reported `Compatible` while npm had formally
deprecated it in favour of a successor. A compatibility flag records whether a
package works today; it says nothing about whether anyone is left to fix it when
the next React Native release breaks it.

That is why the report also surfaces npm deprecation and the directory's
`unmaintained` flag: on a real dependency tree they catch more genuine migration
risk than the incompatibility check alone.

## Status meanings

| Status | Icon | Meaning |
|---|---|---|
| Compatible | `✔` | Confirmed New Architecture support in React Native Directory |
| Incompatible | `✘` | Explicitly marked as not New Architecture ready |
| Unverified | `!` | Listed in the directory, but support isn't confirmed either way |
| Unlisted | `?` | Not found in the directory |
| Unknown | `?` | The lookup failed (network or API error) — re-run to retry |

A package marked `New Arch only` is compatible, but *requires* the New
Architecture — it won't work if you stay on the old one.

### Deprecation

The directory records New Architecture support but knows nothing about
deprecation, so a package can read `Compatible` while npm is actively telling
you to move off it. Every package is therefore also checked against the npm
registry, and any deprecation notice is printed verbatim — it usually names the
successor:

```
✔  react-native-gifted-chat  Compatible  (deprecated, unmaintained)

Deprecated on npm (1 package):
  react-native-gifted-chat
    Maintenance mode - development moved to @kesha-antonov/react-native-chat
```

Deprecation does not affect the exit code: it's a maintenance signal, not a
compatibility one. The npm lookup is best-effort and never fails a scan — if
the registry is unreachable, the compatibility results still stand.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | No confirmed incompatibilities |
| `1` | At least one dependency is confirmed incompatible |
| `2` | The scan could not run, or every lookup failed |

Because a confirmed incompatibility exits `1`, this gates CI as-is:

```yaml
- run: npx rn-arch-check
```

Note that `unverified` does **not** fail the build — only a confirmed
incompatibility does. A scattering of failed lookups doesn't either, but a run
where *every* lookup failed exits `2` rather than `0`, so an offline or blocked
CI runner can't report a clean pass having verified nothing.

## JSON output

```bash
rn-arch-check --json
```

```json
{
  "projectName": "big-rn-app",
  "rnVersion": "0.76.0",
  "results": [
    {
      "name": "react-native-track-player",
      "version": "^4.1.1",
      "status": "incompatible",
      "newArchOnly": false,
      "unmaintained": false,
      "deprecated": null,
      "url": "https://reactnative.directory/?search=react-native-track-player"
    }
  ]
}
```

Lookups that failed carry an extra `error` field. In `--json` mode the progress
spinner and any warnings go to stderr, so stdout stays parseable.

## How it works

1. **Scan** — reads `dependencies` and `devDependencies` from your
   `package.json`. Both are checked: a native module in `devDependencies` still
   ends up in the build.
2. **Filter** — packages with no native code are skipped, since the New
   Architecture can't affect them. That covers pure-JavaScript libraries
   (`lodash`, `dayjs`, `zustand`, `d3-*`, `socket.io-client`), tooling
   (`typescript`, `@types/*`, `@babel/*`, `patch-package`), and React Native's
   own framework packages (`@react-native/*`, `@react-native-community/cli*`),
   which are versioned with the framework rather than tracked individually.
   Real native modules under `@react-native-community/` — `netinfo`,
   `datetimepicker` and friends — are still checked.
3. **Check** — each remaining package is looked up against
   `https://reactnative.directory/api/libraries?search=NAME`, at most
   `--concurrency` at a time, alongside a small npm registry lookup for
   deprecation. The two run in parallel against different hosts, so the load on
   the directory stays within the concurrency cap.
4. **Report** — results are grouped by severity and printed.

### A note on the directory API

The search response only carries a `newArchitecture` field for *some* entries.
Plenty of confirmed-supported libraries — `react-native-screens` among them —
omit it entirely, so classifying purely on that field would report the most
popular New Architecture libraries as "unverified".

When the field is absent, `rn-arch-check` makes one extra request using the
API's `newArchitecture=true` filter, which is authoritative in those cases. So
most packages cost one request and ambiguous ones cost two.

A lookup that fails is marked `unknown` and the scan continues — one flaky
request never sinks the whole report.

### Concurrency and retries

The directory drops connections when too many requests land at once. Measured
on a 15-package project, raising `--concurrency` to 20 caused 7 of 15 lookups
to fail outright — a "faster" scan that quietly verifies less.

Each lookup is therefore retried twice with a short backoff, which clears those
failures at every concurrency level tested. Raising `--concurrency` well above
the default of 5 still buys little, since the bottleneck is the API rather than
the client.

### Expo projects

An Expo project counts as React Native even when it doesn't depend on
`react-native` directly, so it won't trigger the "not a React Native project"
warning. The report header shows whichever of the two versions it finds.

## What is the React Native New Architecture?

The New Architecture is React Native's rewrite of the layer between JavaScript
and native code. It replaces the asynchronous JSON bridge with three pieces:
**JSI**, which lets JavaScript hold direct references to native objects;
**TurboModules**, native modules loaded lazily and called synchronously through
JSI; and **Fabric**, the re-implemented rendering system. *Bridgeless* mode,
default since React Native 0.76, removes the old bridge entirely.

It matters for dependencies because any package shipping native code was written
against one of the two systems. A library that only registers an old-style
native module can fail to load, render nothing, or crash at runtime once the
bridge is gone — which is what this tool checks for, package by package.

### Which versions is this for?

| Setup | New Architecture status |
|---|---|
| React Native 0.76+ | On by default (bridgeless) |
| React Native 0.68 – 0.75 | Opt-in via `newArchEnabled` |
| Expo SDK 52+ | On by default in new projects |
| Expo SDK 51 and earlier | Opt-in |

If you're on React Native 0.76 or newer, or Expo SDK 52 or newer, you are
already running the New Architecture — so any dependency without support is a
live problem rather than a future one.

Primary sources: [The New Architecture](https://reactnative.dev/docs/the-new-architecture/landing-page)
in the React Native docs, the
[0.76 release notes](https://reactnative.dev/blog/2024/10/23/release-0.76-new-architecture)
where it became the default, and Expo's
[New Architecture guide](https://docs.expo.dev/guides/new-architecture/).

## How it compares

**rn-arch-check** is a standalone command-line tool that checks every dependency
in a React Native project against React Native Directory and reports which ones
support the New Architecture.

If you're on **Expo**, [`expo-doctor`](https://docs.expo.dev/develop/tools/#expo-doctor)
already runs a React Native Directory check as part of its wider project
validation, and you should use it — it's first-party tooling and it's already in
your project.

This exists for the cases that fall outside that:

| | `rn-arch-check` | `expo-doctor` |
|---|---|---|
| Bare React Native, no Expo installed | Yes | Not applicable |
| Scope | New Architecture compatibility only | Whole-project validation, of which the directory check is one part |
| Output | Report sorted by severity, with the packages you must act on first | Warnings mixed in with other project checks |
| Exit code | `1` only on a *confirmed* incompatibility, so it can gate CI | Fails on the aggregate of all doctor checks |
| npm deprecation | Flagged, with the notice quoted | Not covered |
| Install | `npx`, nothing added to your project | Part of the Expo toolchain |

The short version: on an Expo project, `expo-doctor` covers this. On a bare
React Native app, or when you want a focused New Architecture gate in CI that
fails on incompatibility and nothing else, use this.

## FAQ

### How do I know if a React Native library supports the New Architecture?

React Native Directory records it per package. Checking by hand means searching
each dependency individually; `npx rn-arch-check` reads your `package.json` and
checks all of them at once.

### What happens if a dependency doesn't support the New Architecture?

It depends on what the package does. Since React Native 0.74 the interop layers
translate many old-architecture modules and view managers automatically, so a
good number of libraries keep working untouched. The ones that don't tend to
fail loudly rather than subtly: the native module never registers and calls into
it return `undefined`, a native view renders as an empty box, or the app crashes
on the first call. Because it's a native-side failure, it won't show up until
you build and run — which is the reason to check the list before you migrate
rather than after.

### The interop layer exists — do I still need to care?

Yes, for some packages. Since React Native 0.74 the interop layers let many
old-architecture libraries run unchanged, which covers a lot of cases. It isn't
complete: libraries that ship or wrap third-party native code are the ones that
tend to break, and those are exactly what this flags.

### What does "Unverified" mean — is the package broken?

No. It means React Native Directory has no record either way, usually because
nobody has updated the entry. Treat it as "test this yourself", not "this is
broken". Check the package's release activity: an actively released library with
no directory entry is far lower risk than one abandoned three years ago.

### Does it work with Expo?

Yes. An Expo project counts as React Native even when it doesn't depend on
`react-native` directly, and the report shows your Expo SDK version.

### How is this different from expo-doctor?

`expo-doctor` runs a React Native Directory check as one part of a wider project
validation, and on an Expo project it already covers this. This is a standalone
CLI for bare React Native projects, and for when you want a check that fails CI
on a confirmed incompatibility and nothing else. See [How it
compares](#how-it-compares) for the full table.

### Does it check transitive dependencies?

No. It reads the `dependencies` and `devDependencies` declared in your
`package.json` — the packages you chose — and does not walk the lockfile. A
native module pulled in only as someone else's transitive dependency won't
appear in the report. In practice that's rarely where migration risk lives:
native modules are almost always direct dependencies, because you have to link
and configure them yourself.

### How do I turn the New Architecture on or off?

On React Native 0.76 and newer it's on by default; set `newArchEnabled=false` in
`android/gradle.properties` and `RCT_NEW_ARCH_ENABLED=0` for iOS to opt back
out, while that remains supported. On 0.68–0.75 the same flags opt you in. Expo
projects set `newArchEnabled` through the `expo-build-properties` plugin. This
tool doesn't change any of those — it only tells you whether your dependencies
are ready before you flip them.

### Can I use it in CI to block a migration?

That's the intended use. It exits `1` when a dependency is confirmed
incompatible, so `npx rn-arch-check` gates a pipeline with no extra
configuration. A run where every lookup failed exits `2`, so an offline runner
can't report a false pass.

### Does it modify my project?

No. It only reads `package.json`. It never installs, writes or changes
anything.

### Why is a package I depend on listed as "Unlisted"?

React Native Directory doesn't track everything. Pure-JavaScript packages and
React Native's own framework packages are filtered out before the check, so
anything still showing as unlisted is usually a native module with no directory
entry — worth verifying by hand.

## Development

```bash
npm install
npm test
```

Tests run against a mock project in `test/fixtures/mock-project` and a stubbed
directory API, so the suite needs no network access.

## Roadmap ideas

- `--fix` flag that opens the React Native Directory page for each
  incompatible package
- Local caching so repeat CI runs don't re-hit the API for unchanged deps
- A GitHub Action wrapper for PR comments
- Monorepo support (scan multiple `package.json` files at once)

## License

MIT

---

Maintained by [mishalibrar](https://github.com/mishalibrar). Compatibility data
comes from [React Native Directory](https://reactnative.directory); deprecation
notices come from the npm registry. Documentation last reviewed August 2026.
