# Upstream issue drafts (justinfagnani/url-pattern-list v0.5.0)

Reproducible divergences between `URLPatternList` v0.5.0 (commit
`4911e649cc11860c7da90c9d0d9b05626c5cbb83`) and its own documented
first-match-wins, drop-in-linear-replacement semantics. Found while
maintaining the OpenElement fork; verified against the npm package
`url-pattern-list@0.5.0` on Node v24.18.0 (native `URLPattern`).

Status: **drafted, not yet filed upstream.**

Both tests below are written in upstream's own style (`node:test` +
`node:assert`) and fail against `src/index.ts` at v0.5.0; the linear
`NaiveURLPatternList` from `src/test/naive-url-pattern-list.ts` passes them.

## Issue 1: first-match semantics broken by zero-consumption children of the same URL component

```js
import {test} from 'node:test';
import * as assert from 'node:assert';
import {URLPatternList} from '../index.js';

test('first added pattern wins over a deeper zero-consumption pattern', () => {
  const list = new URLPatternList();
  list.addPattern(new URLPattern({pathname: '/foo'}), 'first');
  list.addPattern(new URLPattern({pathname: '/foo/:id?'}), 'second');

  // Both patterns match; linear scan returns 'first'.
  const match = list.match('https://example.com/foo');
  assert.strictEqual(match?.value, 'first'); // v0.5.0 returns 'second'
});
```

Also reproduces with `'/:section/:title'` then `'/:section/:title.txt'`
matching `'https://example.com/docs/readme.txt'` (returns the second
pattern).

Root cause: `PrefixTreeNode.tryPatternsAndChildren()` (the
`TODO: I think there's a bug here` site). When the current URL component is
fully consumed and the node has children of the same component type,
`advancedComponentIndex` is not advanced, so `isLastComponent` is false. The
patterns-at-this-node loop is gated on `isLastComponent || bestMatch === null`;
the zero-consuming child (`:id?`) matches first and sets `bestMatch`, so the
pattern that ends at this node is never `test()`ed — even though its
`sequence` is lower. The sequence comparison that guards the children loop
cannot rescue it, because the node-local pattern is never evaluated at all.

Patch direction: when `position >= value.length`, always evaluate the
patterns that end at the current node (ordered by `sequence`) instead of
gating them on `isLastComponent || bestMatch === null`, and pick the lowest
sequence among node patterns and child matches. The `minSequence` pruning of
children stays valid.

## Issue 2: patterns on empty URL components are pruned before exec

```js
import {test} from 'node:test';
import * as assert from 'node:assert';
import {URLPatternList} from '../index.js';

test('a pattern whose search group matches empty is found for a searchless URL', () => {
  const list = new URLPatternList();
  list.addPattern(new URLPattern({pathname: '/foo', search: ':s?'}), 'only');

  // new URLPattern({pathname: '/foo', search: ':s?'}).exec(
  //   'https://example.com/foo') !== null
  const match = list.match('https://example.com/foo');
  assert.strictEqual(match?.value, 'only'); // v0.5.0 returns null
});
```

Also reproduces with `hash: ':h?'`, `search: ':s*'`, `port: ':p?'` and
`username: ':u?'` when the input URL has the corresponding component empty.

Root cause: `URLPatternList.match()` builds the `URLComponent` array only
from non-empty URL components. Tree traversal can never reach a child whose
`urlComponentType` is absent from that array (the component-advance loop in
`tryPatternsAndChildren` runs past the end of the array and skips the child),
so patterns stored under e.g. a search node are never `test()`ed — even when
their pattern part can match the empty string. Empty URL components
effectively disappear from matching.

Patch direction: either build the component array with all eight components
(including empty ones) so traversal can consume an empty component, or treat
a missing component as an empty value when advancing to a child of that
component type. The final `test()`/`exec()` then decides real semantics, as
documented.

## Notes

- A seeded differential fuzz (LCG seed `20260909`, 400 iterations, pathname /
  search / hash pattern fragments vs an ordered-linear oracle) shows 76/400
  mismatches; a pathname-only variant shows 7/400, all instances of these two
  classes.
- The fork does not patch these locally by refining the tree; it replaces the
  component parser/traversal with a fixed pathname-literal index plus a
  conservative set merged by sequence (see DIVERGENCE.md), which is
  oracle-correct by construction. These drafts are for upstream feedback.
