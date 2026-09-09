# @openelement/url-pattern-list

Efficiently match URL paths against a collection of URL patterns using a
fixed pathname-literal index with conservative fallback.

> **Fork note:** this is the OpenElement-maintained fork of
> [justinfagnani/url-pattern-list](https://github.com/justinfagnani/url-pattern-list)
> v0.5.0. See [PROVENANCE.md](./PROVENANCE.md) for sources and license, and
> [DIVERGENCE.md](./DIVERGENCE.md) for what differs and why.

## Overview

`url-pattern-list` is a JavaScript library that provides an efficient way to
match URLs against multiple
[URLPattern](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern)
instances. Instead of testing every pattern linearly, `URLPatternList`
indexes patterns whose pathname is a canonical literal in a fixed prefix
tree, keeps all other patterns in a conservative list, and merges both by
registration order at match time — so only patterns that can possibly match
are exec'd.

`URLPatternList` has exactly the same matching semantics as scanning a
linear list of patterns, and is differentially tested against such a linear
oracle for both native and polyfill URLPattern constructors. The first
pattern (in the order patterns were added to the list) whose complete
`exec()` matches a URL is returned as the match.

Patterns are added to the list along with an additional value that is returned
with the match. This makes it easy to associate a URLPattern with metadata or an
object like a server route handler.

## Installation

```sh
npm i @openelement/url-pattern-list
```

## Quick Start

```typescript
import {URLPatternList} from '@openelement/url-pattern-list';

// Create a new pattern list
const routes = new URLPatternList<string>();

// Add patterns with associated values
routes.addPattern(new URLPattern({pathname: '/api/users/:id'}), 'user-detail');
routes.addPattern(new URLPattern({pathname: '/api/users'}), 'user-list');
routes.addPattern(new URLPattern({pathname: '/api/posts/:id'}), 'post-detail');

// Match against a URL
const match = routes.match('/api/users/123');
if (match) {
  console.log('Route:', match.value); // 'user-detail'
  console.log('User ID:', match.result.pathname.groups.id); // '123'
}
```

## Performance

Lookup cost is driven by the number of candidate patterns exec'd, not the
number of patterns registered: static-heavy workloads exec a handful of
candidates at any scale, while workloads dominated by non-literal patterns
(regex, groups, wildcards) degrade gracefully to linear scan. Benchmarks
cover construction, hit, miss and memory against a linear oracle and
upstream v0.5.0; see [BENCHMARKS.md](./BENCHMARKS.md) for numbers and
methodology.

To run the benchmark on your machine:

```sh
npm i --prefix .tmp-upstream url-pattern-list@0.5.0 # optional comparison
npm run benchmark
```

## API Reference

### URLPatternList&lt;T&gt;

The main class for managing and matching URL patterns.

```ts
import {URLPatternList} from '@openelement/url-pattern-list';
```

#### Methods

##### `addPattern(pattern: ListPattern, value: T): void`

Add a URL pattern to the collection with an associated value. `ListPattern`
is any object with a `pathname` getter and the `exec()` method of the
URLPattern interface — native `URLPattern` and `urlpattern-polyfill`
instances both work.

```typescript
const list = new URLPatternList<RouteHandler>();
list.addPattern(new URLPattern({pathname: '/users/:id'}), handleUserDetail);
```

##### `match(url: string | URL, baseUrl?: string): URLPatternListMatch<T> | null`

Match a URL against all patterns, returning the first match found. Relative
string input requires `baseUrl`; invalid input throws a `TypeError`, even
for an empty list.

```typescript
const match = list.match('/users/123', 'https://example.com');
if (match) {
  // match.result contains the URLPatternResult
  // match.value contains your associated value
}
```

##### `candidateCount(url: string | URL, baseUrl?: string): number`

Diagnostic upper bound on how many patterns `match()` would exec for the
given input. Not part of the matching semantics.

### Types

#### URLPatternListMatch&lt;T&gt;

```typescript
interface URLPatternListMatch<T> {
  result: URLPatternResult; // Standard URLPattern match result
  value: T; // Your associated value
}
```

## Browser Support

This library works with any
[URLPattern](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern)
implementation you supply — native:

- Chrome 95+
- Firefox 142+ (Preview support)
- Safari 26.0+ (Preview support)

— or the [URLPattern
polyfill](https://github.com/kenchris/urlpattern-polyfill) (patterns built
from either constructor can be mixed in one list).

## Visualizer

The upstream visualizer was removed in 0.6.0 because it rendered the
internals of the removed per-component prefix tree. See
[DIVERGENCE.md](./DIVERGENCE.md).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License. See [LICENSE](LICENSE) file for details.

## Related

- [URLPattern on
  MDN](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern)
- [URLPattern Specification](https://urlpattern.spec.whatwg.org/)
- [URLPattern Polyfill](https://github.com/kenchris/urlpattern-polyfill)
