import {describe as suite, test} from 'node:test';
import * as assert from 'node:assert';
import {
  URLPatternList,
  type ListPattern,
  type URLPatternListMatch,
} from '../index.js';
import {URLPattern as URLPatternPolyfill} from 'urlpattern-polyfill';

/**
 * Differential tests: URLPatternList must return the same complete match
 * result and the same value identity as an ordered-linear scan over the same
 * patterns constructed with the same constructor. Each constructor is
 * compared against its own oracle; no cross-constructor equivalence is
 * assumed here.
 */

type PatternConstructor = new (
  init: URLPatternInit,
  options?: {ignoreCase?: boolean},
) => ListPattern;

const globalURLPattern = (globalThis as unknown as {URLPattern?: unknown})
  .URLPattern;
const constructors: ReadonlyArray<readonly [string, PatternConstructor]> = [
  ['polyfill', URLPatternPolyfill as unknown as PatternConstructor],
  ...(globalURLPattern !== undefined
    ? ([['native', globalURLPattern as PatternConstructor]] as ReadonlyArray<
        readonly [string, PatternConstructor]
      >)
    : []),
];

/**
 * The ordered-linear oracle. It mirrors the URLPatternList input contract:
 * one URL normalization boundary (relative strings need baseURL, invalid
 * input throws TypeError), then the first complete exec match in registration
 * order wins.
 */
const oracle = <T>(
  entries: ReadonlyArray<readonly [ListPattern, T]>,
  input: string | URL,
  baseURL?: string,
): URLPatternListMatch<T> | null => {
  const fullURL = new URL(String(input), baseURL).href;
  for (const [pattern, value] of entries) {
    const result =
      baseURL === undefined
        ? pattern.exec(fullURL)
        : pattern.exec(fullURL, baseURL);
    if (result !== null) {
      return {result, value};
    }
  }
  return null;
};

for (const [name, Pattern] of constructors) {
  suite(`URLPatternList ${name}`, () => {
    test('complete results and identity against ordered oracle', () => {
      const patterns = [
        '/',
        '/static',
        '/:id',
        '/a/:first/:second',
        '/assets/:path*',
        '/x/:id(\\d+)',
        '/a{/:id}?',
        '/a/:id+',
        '/a/:id*',
        '/a/\\:literal',
        '/東京',
        '/x/%2F',
        '/shared/prefix/miss',
        '/shared/prefix/:id',
        '/shared/prefix/hit',
        '*',
        '/:__proto__/:constructor',
        '/a//b',
        '/a/',
        '/a/:x([a-z]+)',
      ].map((pathname) => new Pattern({pathname}));
      patterns.push(
        new Pattern({pathname: '/static', search: '', hash: '', port: ''}),
      );
      patterns.push(
        new Pattern({
          protocol: 'https',
          hostname: ':sub.example.com',
          pathname: '/:id',
          search: 'q=:q',
          hash: ':hash',
        }),
      );
      patterns.push(
        new Pattern({
          hostname: 'localhost',
          port: ':port',
          pathname: '/api/:endpoint',
        }),
      );
      const inputs = [
        '/',
        '/static',
        '/a',
        '/a/b',
        '/a/b/c',
        '/a//b',
        '/a/',
        '/a/:literal',
        '/x/123',
        '/x/abc',
        '/assets',
        '/assets/a/b',
        '/東京',
        '/x/%2F',
        '/x/%252F',
        '/x/%',
        '/shared/prefix/hit',
        '/shared/prefix/no',
        '/missing?q=&q=2#h',
        'https://sub.example.com/a?q=1#h',
        'http://localhost:3000/api/users',
        'http://localhost:8080/api',
      ];
      // Every pair, both orders, including duplicate patterns with distinct
      // values.
      for (const first of patterns) {
        for (const second of patterns) {
          const entries = [
            [first, {}],
            [second, {}],
          ] as const;
          const list = new URLPatternList<unknown>();
          for (const [pattern, value] of entries) {
            list.addPattern(pattern, value);
          }
          for (const input of inputs) {
            const url = new URL(input, 'https://example.com');
            const expected = oracle(entries, input, 'https://example.com');
            const actual = list.match(input, 'https://example.com');
            // JSON comparison of full results: node's deepStrictEqual cannot
            // compare two structurally identical native URLPatternResults
            // when a groups object has an own '__proto__' key, and the
            // polyfill's groups objects differ in prototype from native
            // ones. The JSON form captures the observable result content.
            assert.strictEqual(
              JSON.stringify(actual?.result ?? null),
              JSON.stringify(expected?.result ?? null),
              `${name}: ${first.pathname}, ${second.pathname}, ${input}`,
            );
            assert.strictEqual(actual?.value, expected?.value);
            // URL-object input, no baseURL: same normalization, and exec is
            // called without a base, so compare against a base-less oracle.
            assert.strictEqual(
              JSON.stringify(list.match(url)?.result ?? null),
              JSON.stringify(oracle(entries, url)?.result ?? null),
            );
          }
        }
      }
    });

    test('ignoreCase and empty URL components', () => {
      const entries = [
        [new Pattern({pathname: '/Case'}, {ignoreCase: true}), 1],
        [new Pattern({pathname: '/case', search: '', hash: '', port: ''}), 2],
      ] as const;
      const list = new URLPatternList<number>();
      for (const [pattern, value] of entries) {
        list.addPattern(pattern, value);
      }
      for (const input of [
        'https://example.com/case',
        'https://example.com/CASE?q=1',
        'http://example.com:80/case#',
        'http://example.com:81/case',
      ]) {
        const expected = oracle(entries, input);
        const actual = list.match(input);
        assert.deepStrictEqual(
          actual?.result ?? null,
          expected?.result ?? null,
        );
        assert.strictEqual(actual?.value, expected?.value);
      }
    });

    test('seeded literal/conservative permutations', () => {
      const seed = 1324;
      let state = seed;
      const next = () =>
        (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
      for (let iteration = 0; iteration < 150; iteration++) {
        const entries = Array.from({length: 20}, (_, id) => {
          const pathname =
            next() % 3 === 0 ? '/shared/:id' : `/shared/${next() % 30}`;
          return [new Pattern({pathname}), id] as const;
        });
        const input = `https://example.com/shared/${next() % 35}`;
        const mismatch = (
          candidate: ReadonlyArray<readonly [ListPattern, number]>,
        ) => {
          const list = new URLPatternList<number>();
          for (const [pattern, value] of candidate) {
            list.addPattern(pattern, value);
          }
          const actual = list.match(input);
          const expected = oracle(candidate, input);
          return (
            actual?.value !== expected?.value ||
            JSON.stringify(actual?.result) !== JSON.stringify(expected?.result)
          );
        };
        // Deletion shrinking keeps the original input/seed and reduces the
        // route sequence to a 1-minimal reproducer without changing record
        // identities.
        let minimal = entries;
        if (mismatch(entries)) {
          for (let index = 0; index < minimal.length; ) {
            const candidate = minimal.filter((_, i) => i !== index);
            if (mismatch(candidate)) {
              minimal = candidate;
              index = 0;
            } else {
              index++;
            }
          }
        }
        assert.strictEqual(
          mismatch(minimal),
          false,
          `seed=${seed} iteration=${iteration} input=${input} patterns=${JSON.stringify(
            minimal.map(([p, value]) => ({pathname: p.pathname, value})),
          )}`,
        );
      }
    });

    test('invalid and empty input boundary (TypeError), relative + baseURL', () => {
      for (const entries of [
        [],
        [[new Pattern({pathname: '*'}), 1] as const],
      ] as const) {
        const list = new URLPatternList<number>();
        for (const [pattern, value] of entries) {
          list.addPattern(pattern, value);
        }
        assert.throws(() => list.match('/relative'), TypeError);
        assert.throws(() => list.match('http://['), TypeError);
        assert.throws(() => list.match(''), TypeError);
        // Empty string with a base URL resolves to the base, like new URL().
        const expected = oracle(entries, '', 'https://example.com');
        assert.strictEqual(
          list.match('', 'https://example.com')?.value ?? null,
          expected?.value ?? null,
        );
        assert.strictEqual(
          list.match('https://example.com')?.value ?? null,
          entries.length !== 0 ? 1 : null,
        );
      }
    });

    // Regression tests for two bugs found in upstream v0.5.0 (see
    // docs/upstream-issues.md). The fork's semantics are oracle-correct here
    // by construction; these tests pin that down.
    test('regression: first match wins over deeper zero-consumption pattern', () => {
      const entries = [
        [new Pattern({pathname: '/foo'}), 'first'],
        [new Pattern({pathname: '/foo/:id?'}), 'second'],
      ] as const;
      const list = new URLPatternList<string>();
      for (const [pattern, value] of entries) {
        list.addPattern(pattern, value);
      }
      const match = list.match('https://example.com/foo');
      assert.strictEqual(match?.value, 'first');
    });

    test('regression: patterns on empty URL components are not pruned', () => {
      const inits: ReadonlyArray<URLPatternInit> = [
        {pathname: '/foo', search: ':s?'},
        {pathname: '/foo', hash: ':h?'},
        {hostname: 'example.com', port: ':p?'},
        {hostname: 'example.com', username: ':u?'},
      ];
      for (const init of inits) {
        const pattern = new Pattern(init);
        const list = new URLPatternList<string>();
        list.addPattern(pattern, 'only');
        const input = 'https://example.com/foo';
        const expected = oracle([[pattern, 'only']], input);
        assert.deepStrictEqual(
          list.match(input)?.result ?? null,
          expected?.result ?? null,
          `${name}: ${JSON.stringify(init)}`,
        );
        assert.strictEqual(list.match(input)?.value, expected?.value);
      }
    });
  });
}

if ('URLPattern' in globalThis) {
  test('admitted route patterns have consistent native/polyfill observable results', () => {
    for (const pathname of [
      '/',
      '/:id',
      '/a/:x*',
      '/a/:x(\\d+)',
      '/a{/:x}?',
      '/東京',
      '/a//b',
      // '/:__proto__' is intentionally absent: urlpattern-polyfill 10.1.0
      // loses the '__proto__' group key (plain-object groups), while Node's
      // native URLPattern returns it (null-prototype groups). The
      // per-constructor differential suites above still cover it.
    ]) {
      for (const path of [
        '/',
        '/a',
        '/a/123',
        '/a/b/c',
        '/a//b',
        '/東京',
        '/%2F',
        '/%E0%A4%A',
      ]) {
        const input = new URL(path, 'https://example.com').href;
        // JSON comparison: the polyfill's groups objects have a plain
        // prototype while native ones are null-prototype; the observable
        // content is what matters here.
        assert.strictEqual(
          JSON.stringify(new URLPatternPolyfill({pathname}).exec(input)),
          JSON.stringify(new URLPattern({pathname}).exec(input)),
          `${pathname} ${input}`,
        );
      }
    }
  });
}
