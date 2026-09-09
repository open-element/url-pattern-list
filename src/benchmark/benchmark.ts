/**
 * @fileoverview
 *
 * URLPatternList benchmark: construction, hit, miss and memory.
 *
 * Compares three implementations:
 * - this fork's URLPatternList (fixed pathname-literal index + conservative
 *   set, merged by sequence)
 * - NaiveURLPatternList (ordered-linear oracle, from src/test)
 * - upstream url-pattern-list@0.5.0, installed separately into
 *   .tmp-upstream/ (npm i --prefix .tmp-upstream url-pattern-list@0.5.0) or
 *   pointed to with the UPL_UPSTREAM_050 environment variable; skipped when
 *   absent
 *
 * Run with: npm run benchmark (adds --expose-gc via wireit).
 *
 * Methodology: per scenario, patterns are constructed once (native
 * URLPattern) and shared across implementations. Construction time covers
 * list building only. Hit/miss timings are medians of 5 samples of
 * per-lookup means, implementations measured round-robin after a warmup.
 * Retained memory is the heapUsed delta across a gc()-bracketed list build;
 * transient memory is the heapUsed delta across K lookups without gc,
 * divided by K (no GC is expected mid-loop at these allocation volumes;
 * treat as approximate). candidateCount is reported where available.
 */

import {fileURLToPath} from 'node:url';
import * as os from 'node:os';
import * as path from 'node:path';
import {URLPatternList} from '../index.js';
import {NaiveURLPatternList} from '../test/naive-url-pattern-list.js';

const gc = (globalThis as {gc?: () => void}).gc;
if (gc === undefined) {
  throw new Error('Run with node --expose-gc (npm run benchmark does)');
}

interface AnyList {
  addPattern(pattern: URLPattern, value: number): void;
  match(
    url: string,
    baseUrl?: string,
  ): {result: URLPatternResult; value: number} | null;
  candidateCount?: (url: string, baseUrl?: string) => number;
}

const upstreamModulePath =
  process.env.UPL_UPSTREAM_050 ??
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '.tmp-upstream',
    'node_modules',
    'url-pattern-list',
    'index.js',
  );
let UpstreamURLPatternList: (new () => AnyList) | undefined;
try {
  const module = (await import(upstreamModulePath)) as {
    URLPatternList: new () => AnyList;
  };
  UpstreamURLPatternList = module.URLPatternList;
} catch {
  console.log(
    JSON.stringify({
      note:
        `upstream v0.5.0 not found at ${upstreamModulePath}; skipping. ` +
        'Install with: npm i --prefix .tmp-upstream url-pattern-list@0.5.0',
    }),
  );
}

const implementations: Array<{name: string; create: () => AnyList}> = [
  {name: 'fork-0.6.0', create: () => new URLPatternList<number>()},
  {name: 'linear-oracle', create: () => new NaiveURLPatternList<number>()},
];
if (UpstreamURLPatternList !== undefined) {
  const Ctor = UpstreamURLPatternList;
  implementations.push({name: 'upstream-0.5.0', create: () => new Ctor()});
}

interface Scenario {
  readonly name: string;
  readonly patternInits: ReadonlyArray<URLPatternInit>;
  readonly hit: string;
  readonly miss: string;
}

/** Mostly static routes with shared prefixes, plus ~10% parameter routes. */
const realisticPatterns = (count: number): Array<URLPatternInit> => {
  const inits: Array<URLPatternInit> = [];
  const resources = [
    'users',
    'posts',
    'comments',
    'orders',
    'products',
    'articles',
    'photos',
    'files',
  ];
  for (let i = 0; i < count; i++) {
    const resource = resources[i % resources.length];
    if (i % 10 === 9) {
      inits.push({pathname: `/api/v1/${resource}/item/:id/details`});
    } else {
      inits.push({pathname: `/api/v1/${resource}/page-${i}`});
    }
  }
  return inits;
};

/** Patterns that never enter the fixed index: regex, optional, multi-component. */
const complexPatterns = (count: number): Array<URLPatternInit> => {
  const inits: Array<URLPatternInit> = [];
  for (let i = 0; i < count; i++) {
    switch (i % 4) {
      case 0:
        inits.push({pathname: `/api/v${i}/:id(\\d+)/data`});
        break;
      case 1:
        inits.push({pathname: `/api/res-${i}{/:sub}?`});
        break;
      case 2:
        inits.push({pathname: `/api/files-${i}/:path*`});
        break;
      default:
        inits.push({
          hostname: 'example.com',
          pathname: `/api/multi/:id`,
          search: `q=:q`,
        });
        break;
    }
  }
  return inits;
};

const scenarios = (count: number): Array<Scenario> => [
  {
    name: 'realistic',
    patternInits: realisticPatterns(count),
    hit: `/api/v1/${['users', 'posts', 'comments', 'orders', 'products', 'articles', 'photos', 'files'][(count - 2) % 8]}/page-${count - 2}`,
    miss: '/api/v1/users/nonexistent',
  },
  {
    name: 'static-only',
    patternInits: Array.from({length: count}, (_, i) => ({
      pathname: `/static/group-${i % 25}/asset-${i}.dat`,
    })),
    hit: `/static/group-${(count - 1) % 25}/asset-${count - 1}.dat`,
    miss: '/static/group-0/not-there.dat',
  },
  {
    name: 'complex',
    patternInits: complexPatterns(count),
    hit: `/api/v${count - 4}/123/data`,
    miss: '/api/v1/abc/data',
  },
  {
    name: 'front-conservative',
    patternInits: [
      {pathname: '/assets/:path*'},
      ...Array.from({length: count - 1}, (_, i) => ({
        pathname: `/img/catalog/item-${i}`,
      })),
    ],
    hit: `/img/catalog/item-${count - 2}`,
    miss: '/img/catalog/missing',
  },
];

const median = (values: Array<number>): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const SAMPLES = 5;

const runScenario = (scenario: Scenario): void => {
  const count = scenario.patternInits.length;
  const lookupsPerSample = Math.max(
    25,
    Math.min(500, Math.floor(50000 / count)),
  );
  const warmup = Math.max(5, Math.min(100, Math.floor(lookupsPerSample / 5)));
  const patterns = scenario.patternInits.map((init) => new URLPattern(init));

  for (const impl of implementations) {
    // Construction: median list-build time over SAMPLES fresh builds.
    const builds: Array<number> = [];
    let list!: AnyList;
    for (let sample = 0; sample < SAMPLES; sample++) {
      const start = performance.now();
      list = impl.create();
      for (let i = 0; i < count; i++) {
        list.addPattern(patterns[i], i);
      }
      builds.push(performance.now() - start);
    }

    // Sanity: all implementations agree on hit and miss values.
    const hitMatch = list.match(scenario.hit, 'https://example.com');
    const missMatch = list.match(scenario.miss, 'https://example.com');

    // Hit/miss: round-robin warmup, then SAMPLES samples of per-lookup means.
    const time = (input: string): number => {
      for (let i = 0; i < warmup; i++) {
        list.match(input, 'https://example.com');
      }
      const samples: Array<number> = [];
      for (let sample = 0; sample < SAMPLES; sample++) {
        const start = performance.now();
        for (let i = 0; i < lookupsPerSample; i++) {
          list.match(input, 'https://example.com');
        }
        samples.push((performance.now() - start) / lookupsPerSample);
      }
      return median(samples);
    };
    const hitMs = time(scenario.hit);
    const missMs = time(scenario.miss);

    // Retained memory: heapUsed delta across a gc-bracketed build. Patterns
    // are constructed outside the bracket and not counted.
    const retainedSamples: Array<number> = [];
    const kept: Array<AnyList> = [];
    for (let sample = 0; sample < SAMPLES; sample++) {
      gc();
      const before = process.memoryUsage().heapUsed;
      const fresh = impl.create();
      for (let i = 0; i < count; i++) {
        fresh.addPattern(patterns[i], i);
      }
      gc();
      retainedSamples.push(process.memoryUsage().heapUsed - before);
      kept.push(fresh);
    }
    kept.length = 0;

    // Transient allocation per lookup: heapUsed delta across K lookups with
    // no gc, divided by K. No GC is expected mid-loop at this volume; the
    // number includes the normalized URL and the exec result per call.
    const transientSamples: Array<number> = [];
    const transientK = 500;
    for (let sample = 0; sample < SAMPLES + 2; sample++) {
      gc();
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < transientK; i++) {
        list.match(scenario.hit, 'https://example.com');
      }
      const delta = process.memoryUsage().heapUsed - before;
      if (sample >= 2) {
        transientSamples.push(delta / transientK);
      }
    }

    console.log(
      JSON.stringify({
        scenario: scenario.name,
        count,
        impl: impl.name,
        samples: SAMPLES,
        lookupsPerSample,
        warmup,
        buildMedianMs: median(builds),
        hitMedianMs: hitMs,
        missMedianMs: missMs,
        hitValue: hitMatch?.value ?? null,
        missValue: missMatch?.value ?? null,
        hitCandidates: list.candidateCount?.(
          scenario.hit,
          'https://example.com',
        ),
        missCandidates: list.candidateCount?.(
          scenario.miss,
          'https://example.com',
        ),
        retainedBytesMedian: median(retainedSamples),
        retainedBytesPerPattern: median(retainedSamples) / count,
        transientBytesPerHit: median(transientSamples),
      }),
    );
  }
};

console.log(
  JSON.stringify({
    runtime: `node ${process.version}`,
    platform: `${process.platform} ${process.arch}`,
    cpu: os.cpus()[0]?.model,
    gcControl: 'node --expose-gc; global.gc() around memory measurements',
    samples: SAMPLES,
    note:
      'construction = list build only (patterns pre-constructed, native URLPattern); ' +
      'hit/miss = median of per-lookup means; retained = gc-bracketed heapUsed delta; ' +
      'transient = heapUsed delta across 500 lookups without gc (approximate)',
  }),
);

for (const count of [100, 1000, 5000]) {
  for (const scenario of scenarios(count)) {
    runScenario(scenario);
  }
}
