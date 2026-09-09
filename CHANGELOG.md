# Changelog

## 0.6.0 (unreleased)

First OpenElement fork release, based on upstream
[justinfagnani/url-pattern-list](https://github.com/justinfagnani/url-pattern-list)
v0.5.0 (commit `4911e649cc11860c7da90c9d0d9b05626c5cbb83`). See
`PROVENANCE.md` and `DIVERGENCE.md`.

- **Changed matching internals**: patterns with a canonical pathname literal
  (restricted ASCII alphabet) are indexed in a fixed prefix tree; all other
  patterns stay in a conservative list; candidates are merged by
  registration order and the first complete `exec()` match wins. This fixes
  two divergences from ordered-linear semantics present in upstream 0.5.0
  (see `docs/upstream-issues.md`): first-match shadowing by zero-consumption
  children, and patterns on empty URL components never being matched.
- **Added**: `ListPattern` interface — `addPattern()` now accepts any
  pattern object with a `pathname` getter and `exec()`, so both native
  `URLPattern` and `urlpattern-polyfill` instances work.
- **Added**: `candidateCount()` diagnostic.
- **Removed**: the component pattern parser (`lib/parse-pattern`), the
  per-component prefix tree node classes and `_treeRoot` (internal but
  exported in 0.5.0), and the visualizer (`./visualizer.js` export,
  `visualizer.md`), which rendered the removed tree internals.
- **Package**: renamed to `@open-element/url-pattern-list`. Version 0.6.0
  is a minor bump of the fork's 0.x line for the internal matching-semantics
  change and removed internal exports.

## 0.5.0 and earlier

See upstream history:
<https://github.com/justinfagnani/url-pattern-list/releases>
