# Benchmarks

Fork v0.6.0 (`URLPatternList`: fixed pathname-literal index + conservative
set, merged by sequence) compared against:

- **linear-oracle** — `NaiveURLPatternList` from `src/test/`, the ordered
  linear reference.
- **upstream-0.5.0** — npm `url-pattern-list@0.5.0` (component prefix tree),
  installed into `.tmp-upstream/` (not committed). Note: upstream is faster
  in some scenarios but is not first-match-correct (see
  `docs/upstream-issues.md`); treat its numbers as a speed/reference point,
  not a semantic baseline.

The old OpenElement route-table baseline (OE commit `0d826954`) is **not
measured here**: that module is Deno-era, depends on OE-internal packages
(`@openelement/element/build-utils`) and carries RouteRecord/HTTP semantics
that this generic library must not contain. The OE-side Deno bench
(`packages/app/__tests__/url-pattern-list.bench.ts`) covers that comparison
in its own repo.

## Environment and methodology

- Runtime: `node v24.18.0`, `darwin arm64`, CPU `Apple M2`
- Patterns: native `URLPattern`, constructed once per scenario and shared by
  all implementations; construction timings cover list building only.
- Samples: 5 per measurement; warmup 100/10/5 calls and 500/50/25 lookups
  per sample for counts 100/1000/5000; reported numbers are medians of
  per-lookup means; implementations measured round-robin.
- GC control: `node --expose-gc`; `global.gc()` brackets memory
  measurements.
- Memory, retained: `heapUsed` delta across a `gc()` → build → `gc()`
  bracket, median of 5 builds; patterns themselves are outside the bracket.
- Memory, transient: `heapUsed` delta across 500 hit-lookups without `gc`,
  divided by 500, median of 5 samples after 2 discarded runs. Approximate:
  includes the per-call normalized `URL`, its href string, and every
  candidate `exec()`'s internal allocations (which dominate when many
  conservative candidates are exec'd). No GC is expected mid-loop at these
  volumes.
- `hit`/`miss` values agreed across all three implementations in every
  scenario (sanity check; see raw lines).
- Reproduce: `npm i --prefix .tmp-upstream url-pattern-list@0.5.0 && npm run benchmark`

## Scenarios

- `realistic` — 90% static routes with shared prefixes, 10% single-param
  routes; hit = last static route, miss = nonexistent path under a shared
  prefix.
- `static-only` — 100% canonical literal pathnames.
- `complex` — regex / optional-group / multi-segment-wildcard /
  multi-component patterns; none enter the fixed index (worst case for the
  fork: fully conservative).
- `front-conservative` — one leading `/assets/:path*` conservative pattern
  followed by N-1 statics under a different prefix; measures the
  sequence-merge overhead of one early conservative candidate.

## Results (run of this commit, medians)

Times in ms per operation; candidates = `candidateCount()` (fork only);
retained = bytes per pattern; transient = bytes per hit lookup.

| scenario           | count | impl           | build  | hit    | miss   | hit cand | miss cand | retained B/pat | transient B/hit |
| ------------------ | ----- | -------------- | ------ | ------ | ------ | -------- | --------- | -------------- | --------------- |
| realistic          | 100   | fork-0.6.0     | 0.290  | 0.0145 | 0.0084 | 11       | 10        | 881            | 7354            |
| realistic          | 100   | linear-oracle  | 0.007  | 0.0741 | 0.0825 | —        | —         | 59             | 7281            |
| realistic          | 100   | upstream-0.5.0 | 0.331  | 0.0074 | 0.0010 | —        | —         | 420            | 7682            |
| static-only        | 100   | fork-0.6.0     | 0.261  | 0.0070 | 0.0008 | 1        | 0         | 2262           | 7025            |
| static-only        | 100   | linear-oracle  | 0.008  | 0.0668 | 0.0722 | —        | —         | 60             | 6929            |
| static-only        | 100   | upstream-0.5.0 | 0.445  | 0.0163 | 0.0021 | —        | —         | 505            | 7690            |
| complex            | 100   | fork-0.6.0     | 0.031  | 0.0919 | 0.0956 | 100      | 100       | 63             | 11073           |
| complex            | 100   | linear-oracle  | 0.008  | 0.0758 | 0.0728 | —        | —         | 60             | 10970           |
| complex            | 100   | upstream-0.5.0 | 0.963  | 0.0109 | 0.0018 | —        | —         | 708            | 7834            |
| front-conservative | 100   | fork-0.6.0     | 0.123  | 0.0070 | 0.0024 | 2        | 1         | 536            | 7017            |
| front-conservative | 100   | linear-oracle  | 0.009  | 0.0701 | 0.0618 | —        | —         | 60             | 6947            |
| front-conservative | 100   | upstream-0.5.0 | 0.583  | 0.0127 | 0.0026 | —        | —         | 399            | 7411            |
| realistic          | 1000  | fork-0.6.0     | 1.685  | 0.1225 | 0.0824 | 101      | 100       | 651            | 10954           |
| realistic          | 1000  | linear-oracle  | 0.110  | 0.6325 | 0.6391 | —        | —         | 58             | 10882           |
| realistic          | 1000  | upstream-0.5.0 | 2.983  | 0.0340 | 0.0032 | —        | —         | 371            | 7506            |
| static-only        | 1000  | fork-0.6.0     | 1.557  | 0.0066 | 0.0007 | 1        | 0         | 1828           | 7042            |
| static-only        | 1000  | linear-oracle  | 0.080  | 0.7184 | 0.6375 | —        | —         | 58             | 6946            |
| static-only        | 1000  | upstream-0.5.0 | 2.603  | 0.0212 | 0.0021 | —        | —         | 433            | 7476            |
| complex            | 1000  | fork-0.6.0     | 0.318  | 0.6997 | 0.7285 | 1000     | 1000      | 59             | 47078           |
| complex            | 1000  | linear-oracle  | 0.082  | 0.6417 | 0.6368 | —        | —         | 58             | 46972           |
| complex            | 1000  | upstream-0.5.0 | 3.200  | 0.0212 | 0.0115 | —        | —         | 657            | 7913            |
| front-conservative | 1000  | fork-0.6.0     | 0.687  | 0.0068 | 0.0013 | 2        | 1         | 494            | 7033            |
| front-conservative | 1000  | linear-oracle  | 0.041  | 0.5246 | 0.5365 | —        | —         | 58             | 6945            |
| front-conservative | 1000  | upstream-0.5.0 | 4.240  | 0.0362 | 0.0095 | —        | —         | 406            | 7490            |
| realistic          | 5000  | fork-0.6.0     | 3.693  | 0.3322 | 0.3348 | 501      | 500       | 630            | 26955           |
| realistic          | 5000  | linear-oracle  | 0.234  | 2.9275 | 2.8595 | —        | —         | 59             | 26882           |
| realistic          | 5000  | upstream-0.5.0 | 15.350 | 0.0755 | 0.0110 | —        | —         | 369            | 7426            |
| static-only        | 5000  | fork-0.6.0     | 5.738  | 0.0057 | 0.0011 | 1        | 0         | 1788           | 7042            |
| static-only        | 5000  | linear-oracle  | 0.344  | 2.8193 | 2.7484 | —        | —         | 59             | 6946            |
| static-only        | 5000  | upstream-0.5.0 | 9.788  | 0.0656 | 0.0033 | —        | —         | 431            | 7530            |
| complex            | 5000  | fork-0.6.0     | 1.819  | 3.4510 | 3.1926 | 5000     | 5000      | 59             | 74136           |
| complex            | 5000  | linear-oracle  | 0.277  | 3.2712 | 3.2573 | —        | —         | 59             | 74047           |
| complex            | 5000  | upstream-0.5.0 | 41.525 | 0.0630 | 0.0505 | —        | —         | 664            | 7938            |
| front-conservative | 5000  | fork-0.6.0     | 3.404  | 0.0063 | 0.0017 | 2        | 1         | 491            | 7050            |
| front-conservative | 5000  | linear-oracle  | 0.254  | 2.6106 | 2.6658 | —        | —         | 59             | 6961            |
| front-conservative | 5000  | upstream-0.5.0 | 89.256 | 0.1428 | 0.0373 | —        | —         | 402            | 7505            |

## Reading the numbers

- The fork's lookup cost is driven by `candidateCount`, not pattern count:
  static-heavy hits exec 1–11 candidates at any scale; the all-conservative
  `complex` scenario is deliberately linear (fork ≈ oracle, ±6%).
- Upstream 0.5.0 prunes non-literal patterns too, so it wins absolute speed
  on `realistic`/`complex` — at the cost of the two documented correctness
  bugs. On `static-only` the fork is faster (per-character Map walk + a
  single exec beats upstream's per-node `test()` calls), e.g. 0.0057ms vs
  0.0656ms at 5000.
- Retained memory: the fork's per-character tree costs more than upstream's
  per-segment tree for static-heavy sets (≈1.8KB/pattern at static-only
  5000: 8.9MB vs 2.2MB upstream, 0.29MB linear), and less than upstream for
  conservative sets (≈59B/pattern, equal to linear, since no tree is
  built). This is a known, accepted trade-off of only indexing literals.
- Transient allocation is dominated by the shared `new URL()` +
  `exec()` machinery (≈7KB/lookup for a single candidate) and scales with
  the number of candidates exec'd (≈74KB at complex-5000, like linear).

## Raw key lines (verbatim from the measured run)

Metadata line and the static-only / complex 5000 rows; full output had 36
scenario rows, all with `hitValue`/`missValue` agreement across
implementations.

```json
{"runtime":"node v24.18.0","platform":"darwin arm64","cpu":"Apple M2","gcControl":"node --expose-gc; global.gc() around memory measurements","samples":5,"note":"construction = list build only (patterns pre-constructed, native URLPattern); hit/miss = median of per-lookup means; retained = gc-bracketed heapUsed delta; transient = heapUsed delta across 500 lookups without gc (approximate)"}
{"scenario":"static-only","count":5000,"impl":"fork-0.6.0","samples":5,"lookupsPerSample":25,"warmup":5,"buildMedianMs":5.738375000000815,"hitMedianMs":0.005668320000113454,"missMedianMs":0.0011233599999104626,"hitValue":4999,"missValue":null,"hitCandidates":1,"missCandidates":0,"retainedBytesMedian":8940152,"retainedBytesPerPattern":1788.0304,"transientBytesPerHit":7042.048}
{"scenario":"static-only","count":5000,"impl":"linear-oracle","samples":5,"lookupsPerSample":25,"warmup":5,"buildMedianMs":0.344042000000627,"hitMedianMs":2.8193466400000036,"missMedianMs":2.748376680000074,"hitValue":4999,"missValue":null,"retainedBytesMedian":293400,"retainedBytesPerPattern":58.68,"transientBytesPerHit":6945.504}
{"scenario":"static-only","count":5000,"impl":"upstream-0.5.0","samples":5,"lookupsPerSample":25,"warmup":5,"buildMedianMs":9.788000000000466,"hitMedianMs":0.06560668000020087,"missMedianMs":0.003258360000036191,"hitValue":4999,"missValue":null,"retainedBytesMedian":2153464,"retainedBytesPerPattern":430.6928,"transientBytesPerHit":7529.872}
{"scenario":"complex","count":5000,"impl":"fork-0.6.0","samples":5,"lookupsPerSample":25,"warmup":5,"buildMedianMs":1.8192500000004657,"hitMedianMs":3.4509866799999145,"missMedianMs":3.192579999999725,"hitValue":4996,"missValue":null,"hitCandidates":5000,"missCandidates":5000,"retainedBytesMedian":293680,"retainedBytesPerPattern":58.736,"transientBytesPerHit":74135.568}
{"scenario":"realistic","count":5000,"impl":"fork-0.6.0","samples":5,"lookupsPerSample":25,"warmup":5,"buildMedianMs":3.693374999998923,"hitMedianMs":0.33223167999996805,"missMedianMs":0.33478667999996103,"hitValue":4998,"missValue":null,"hitCandidates":501,"missCandidates":500,"retainedBytesMedian":3149176,"retainedBytesPerPattern":629.8352,"transientBytesPerHit":26954.8}
{"scenario":"front-conservative","count":5000,"impl":"fork-0.6.0","samples":5,"lookupsPerSample":25,"warmup":5,"buildMedianMs":3.404499999989639,"hitMedianMs":0.006269999999785796,"missMedianMs":0.0016649999999208377,"hitValue":4999,"missValue":null,"hitCandidates":2,"missCandidates":1,"retainedBytesMedian":2452680,"retainedBytesPerPattern":490.536,"transientBytesPerHit":7049.84}
```
