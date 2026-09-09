# URLPatternList Copilot Instructions

## Overview

This library implements a `URLPattern` collection called a `URLPatternList`
that has optimized matching against the set of patterns using a **fixed
pathname-literal prefix tree with a conservative fallback list**, instead of
linear scanning.

This repo is the OpenElement-maintained fork of
justinfagnani/url-pattern-list v0.5.0. Read `PROVENANCE.md` and
`DIVERGENCE.md` before changing matching internals.

`URLPattern` is a web standard that is also available in server runtimes like
Node and Deno.

- URLPattern on MDN:
  https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API
- Specification: https://urlpattern.spec.whatwg.org/

`URLPattern` is often used for client-side and HTTP-server routing. Especially
in the server routing use case, a server might have hundreds or thousands of
routes and need to match an incoming request URL to a route as fast as
possible. Linearly scanning a list of URLPattern and testing each pattern does
not scale well enough, and indexing static routes can be much faster.

## API

`URLPatternList` has two main APIs:

- `addPattern(pattern, value)` which adds a new pattern to the list and
  indexes it.
- `match(url, baseUrl)` which returns the first pattern whose complete
  `exec()` matches, in registration order.

Patterns cannot currently be removed or inserted into the middle of the list.
This may be an important feature to add in the future.

`pattern` is the structural `ListPattern` interface (a `pathname` getter plus
the `exec()` method of the URLPattern interface), so native `URLPattern` and
`urlpattern-polyfill` instances both work. Pattern parsing, compilation and
capture semantics belong to the pattern's constructor; this library only
stores, indexes and matches.

## Architecture

### Indexing

`src/index.ts` splits patterns into two collections at `addPattern()` time:

- Patterns whose `pathname` is a canonical literal — starts with `/` and uses
  only the alphabet `a-zA-Z0-9/_-.%~` — go into a per-character fixed prefix
  tree keyed by the ASCII-case-folded pathname. Case folding over-selects
  candidates (and admits `ignoreCase` patterns without reading non-standard
  options); `exec()` decides real case semantics.
- Every other pattern (groups, regex, wildcards, escapes, empty paths,
  Unicode) goes into a conservative list in registration order.

Each stored `URLPatternListItem` carries a `sequence` number recording
registration order.

### URL Matching

`match()` normalizes the input once with `new URL()` (invalid input throws
`TypeError`, even for an empty list; relative strings need `baseUrl`). It
collects the fixed-tree candidates whose literal key equals the URL's
case-folded pathname, merges them with the conservative list by `sequence`,
and returns the first complete `exec()` match with its value. `baseUrl` is
passed through to `exec()` so `result.inputs` matches upstream behavior.

Correctness rule: pruning must only use conditions that are necessary for
`exec()` to match. Canonical pathname literal equality is such a condition;
nothing else (in particular no other URL component, and no pattern grammar
judgement) may prune a candidate, so empty URL components can never
disappear from matching and the final `exec()` sees every pattern that could
match.

## Development Workflows

This repo uses Wireit to coordinate and cache scripts. Wireit is transparent to
script runners, you use `npm` commands as usual. The important thing to know is
that Wireit runs script dependencies automatically - you don't have to run the
build script manually before tests.

- Build:
  ```bash
  npm run build
  ```
- Test:
  ```sh
  npm test
  ```
- Benchmarks:
  ```sh
  npm i --prefix .tmp-upstream url-pattern-list@0.5.0 # optional comparison
  npm run benchmark
  ```

After major changes, run benchmarks to ensure no performance regressions and
record the numbers in `BENCHMARKS.md` if the change is performance-relevant.

When generating temporary debug scripts that aren't included in the build, you
do need to run the build first if the implementation has changed.

## Code Style

- Use very modern TypeScript: TypeScript 5.9 and JavaScript ES2024
- Always use ESM module syntax and never CommonJS
- Indent code 2 spaces
- Wrap code and comments at 80 columns
- Use arrow functions instead of the `function` keyword
- Use `undefined` for missing values instead of `null`, except when emulating
  DOM APIs that return `null`
- Use `const` everywhere possible, and `let` for mutable variables
- Always use `===` instead of `==` for comparisons
- Avoid boolean conversions and truthiness checks. Use explicit comparisons,
  like `if (x === undefined) {}`
- Try to avoid unnecessary object and string allocations. Use the `position`
  argument to string methods like `indexOf()` and `startsWith()`, and track
  current positions in our own methods to avoid calling `str.slice()`
- Use standard private fields, like `#foo`
- Prefer top-level functions for utilities instead of static class methods
- Keep tests as small as possible and focused on single scenarios
- Avoid assertion messages, except where a failure must be reproducible
  (seeded differential tests)
- Test files are in `src/test` and end with `_test.ts`

## Testing

Tests are written with Node's `node:test` and `node:assert` packages, and run
with `node --test` as configured in the `wireit.build` object in
`package.json`.

### Test Philosophy

- **Dual validation**: `url-pattern-list_test.ts` runs every scenario against
  both the optimized `URLPatternList` and the naive linear implementation.
- **Differential validation**: `differential_test.ts` compares complete match
  results and value identity with an ordered-linear oracle, for both the
  native and the polyfill URLPattern constructors, over a pairwise pattern
  matrix, a seeded permutation corpus (LCG seed 1324) and input-boundary
  cases.
- **URLPattern compliance**: pattern semantics are never reimplemented here;
  tests assert equality with the constructor's own `exec()` results.

## Key Files

- `src/index.ts`: fixed pathname-literal index, conservative list and the
  URLPatternList class
- `src/test/naive-url-pattern-list.ts`: Reference linear implementation for
  validation
- `src/test/differential_test.ts`: Differential oracle tests
- `src/benchmark/benchmark.ts`: Performance and memory measurement
- `DIVERGENCE.md` / `PROVENANCE.md`: Fork differences and provenance
- `docs/upstream-issues.md`: Minimal reproductions of confirmed upstream bugs

## Debugging Tips

- Use `list.candidateCount(url, baseUrl)` to see how many patterns `match()`
  would exec for an input
- Benchmark against the naive implementation and upstream 0.5.0
  (`.tmp-upstream`) to verify performance characteristics
