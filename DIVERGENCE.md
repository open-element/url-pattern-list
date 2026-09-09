# Divergence from upstream

Each difference between this fork and upstream v0.5.0 (commit `4911e649`),
and why. The fork's goal is a small, auditable matching core whose semantics
are exactly those of an ordered linear scan.

## Matching core (`src/index.ts`)

**What changed:** the per-URL-component prefix tree (fixed/wildcard/regex
nodes over protocol…hash, built by `src/lib/parse-pattern.ts`) is replaced
by:

- a fixed per-character prefix tree over **canonical pathname literals only**
  (a deliberately small ASCII alphabet: `a-zA-Z0-9/_-.%~`; the key is ASCII
  case-folded, which over-approximates — `exec()` decides real case
  semantics), and
- a conservative list holding every other pattern.

At match time both collections are merged by registration `sequence` and the
first complete `exec()` match wins. Pruning never involves URL components
other than the pathname literal.

**Why:**

- Upstream's wildcard/regex traversal prunes candidates before `exec()`;
  its correctness could not be established, and final `exec()` cannot rescue
  a wrongly pruned candidate. Two reproducible divergences from
  ordered-linear semantics were found in v0.5.0 (minimal repros in
  `docs/upstream-issues.md`): first-match shadowing by zero-consumption
  children of the same component, and patterns on empty URL components
  (e.g. `search: ':s?'` vs a searchless URL) never being reached.
- The fork's pruning condition (canonical pathname literal equality) is a
  necessary condition for `exec()` to match, so no possibly-earlier match is
  ever discarded.

## Removed code

- `src/lib/parse-pattern.ts` (pattern-string parser) and its test: only the
  removed tree consumed it. URLPattern grammar/parsing belongs to the
  native/polyfill constructor.
- `src/visualizer.ts`, its test/demo and `visualizer.md`: the visualizer
  rendered the removed tree's internals (`_treeRoot`, node classes). It can
  be reintroduced against the new index if needed.
- Exported tree internals (`PrefixTreeNode` and subclasses, `_treeRoot`):
  gone with the tree. They were `@internal` but technically exported.

## API surface

- Kept: `URLPatternList` with `addPattern(pattern, value)` and
  `match(url, baseUrl)`; `URLPatternListItem`, `URLPatternListMatch`.
- `addPattern()` and `URLPatternListItem.pattern` now take the structural
  `ListPattern` interface (`pathname` getter + `exec()`), so native
  `URLPattern` and `urlpattern-polyfill` instances both work without
  touching globals. All existing `URLPattern` callers are unaffected.
- Added: `candidateCount(url, baseUrl)` — a diagnostic upper bound on how
  many patterns `match()` would exec; not part of matching semantics.
- Unchanged input boundary: relative strings require `baseUrl`; invalid
  input throws `TypeError` even for an empty list; `match()` passes
  `baseUrl` through to `exec()` so `result.inputs` matches upstream.

## Tooling

- Unchanged habits: `tsc --build`, `node --test`, wireit, prettier.
- Benchmark rewritten for construction / hit / miss / memory with GC
  control; see `BENCHMARKS.md`. Compares against the in-repo linear oracle
  and upstream 0.5.0 (installed separately, not committed).
- Added devDependency `urlpattern-polyfill` (differential tests against both
  constructors).

## Package

- Renamed to `@openelement/url-pattern-list`, version `0.6.0`: the
  internal matching semantics changed and internal exports were removed (a
  minor bump under the fork's 0.x line). See `CHANGELOG.md`.
- Repository/bugs/homepage point at `open-element/url-pattern-list`.
  `author` remains Justin Fagnani; see `PROVENANCE.md`.

## Upstream feedback status

- Drafted, not yet filed: `docs/upstream-issues.md` contains two
  recipient-native minimal reproductions (`node:test`, upstream style) with
  root-cause analysis and patch directions for both confirmed v0.5.0 bugs.
- The fixed-index + conservative-set matching core is potentially
  upstreamable as an alternative implementation once the upstream bugs are
  addressed or the approaches are reconciled.
