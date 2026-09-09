/**
 * url-pattern-list - efficiently match URLs against a collection of URL
 * patterns.
 *
 * This implementation is derived from the semantics OpenElement established
 * for its maintained fork: only canonical pathname literals are indexed, every
 * other pattern is matched conservatively, and candidates are merged by
 * registration order before a full `exec()` decides the match. See
 * PROVENANCE.md and DIVERGENCE.md.
 */

/**
 * The minimal pattern interface stored by a URLPatternList.
 *
 * Any object with a `pathname` getter and the `exec()` method of the
 * URLPattern interface works: native `URLPattern` instances and
 * polyfill (`urlpattern-polyfill`) instances alike. Pattern parsing,
 * compilation and capture semantics belong entirely to the pattern's
 * constructor; this library only stores, indexes and matches patterns in
 * registration order.
 */
export interface ListPattern {
  readonly pathname: string;
  exec(input: string, baseURL?: string): URLPatternResult | null;
}

/**
 * The internal storage for a URL pattern and its metadata.
 *
 * @internal
 */
export interface URLPatternListItem<T> {
  readonly sequence: number;
  readonly pattern: ListPattern;
  readonly value: T;
}

/**
 * The return type of `URLPatternList.match()`.
 *
 * Includes the result of `pattern.exec()` and the matching pattern's associated
 * metadata value.
 */
export interface URLPatternListMatch<T> {
  result: URLPatternResult;
  value: T;
}

/**
 * A node in the fixed pathname prefix tree. Each node holds the patterns whose
 * canonical pathname literal ends exactly at this node.
 */
class FixedPrefixTreeNode<T> {
  readonly children = new Map<string, FixedPrefixTreeNode<T>>();
  readonly patterns: Array<URLPatternListItem<T>> = [];
}

/**
 * Returns the index key for a pattern pathname, or `undefined` if the pathname
 * is not a canonical literal.
 *
 * This is deliberately a small literal alphabet, not a URLPattern grammar
 * parser. These characters have no pattern operators or escapes. Every other
 * spelling remains conservative, including groups, regex, empty paths and
 * Unicode.
 *
 * ASCII case folding over-selects candidates for case-sensitive patterns and
 * admits ignoreCase patterns without relying on a non-standard URLPattern
 * options getter; `exec()` still determines the real case semantics.
 */
const literalPathnameKey = (pathname: string): string | undefined => {
  if (!pathname.startsWith('/')) {
    return undefined;
  }
  for (const char of pathname) {
    if (
      !'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/_-.%~'.includes(
        char,
      )
    ) {
      return undefined;
    }
  }
  return pathname.toLowerCase();
};

/**
 * A collection of URL patterns and associated values, with methods for adding
 * patterns and matching URLs against those patterns.
 *
 * Patterns with a canonical pathname literal are stored in a fixed prefix tree
 * keyed by that literal; all other patterns are stored in a conservative list.
 * Matching execs the candidates of both collections in registration order and
 * returns the first complete match. This maintains first-match-wins
 * semantics - the result is the same as scanning a linear list of patterns -
 * while only execing the patterns that can possibly match.
 *
 * Pruning is based solely on canonical pathname literal equality, which is a
 * necessary condition for `exec()` to match. Pruning never involves other URL
 * components, so empty URL components never disappear from matching and the
 * final `exec()` sees every pattern that could match.
 */
export class URLPatternList<T> {
  readonly #root = new FixedPrefixTreeNode<T>();
  readonly #conservative: Array<URLPatternListItem<T>> = [];
  #sequenceCounter = 0;

  /**
   * Add a URL pattern to the collection.
   */
  addPattern(pattern: ListPattern, value: T): void {
    const item: URLPatternListItem<T> = {
      sequence: this.#sequenceCounter++,
      pattern,
      value,
    };
    const key = literalPathnameKey(pattern.pathname);
    if (key === undefined) {
      this.#conservative.push(item);
      return;
    }
    let node = this.#root;
    for (const char of key) {
      let child = node.children.get(char);
      if (child === undefined) {
        child = new FixedPrefixTreeNode<T>();
        node.children.set(char, child);
      }
      node = child;
    }
    node.patterns.push(item);
  }

  /**
   * The patterns whose canonical pathname literal equals the URL's pathname.
   */
  #fixedCandidates(url: URL): ReadonlyArray<URLPatternListItem<T>> {
    let node: FixedPrefixTreeNode<T> | undefined = this.#root;
    for (const char of url.pathname.toLowerCase()) {
      node = node.children.get(char);
      if (node === undefined) {
        return [];
      }
    }
    return node.patterns;
  }

  /**
   * Match a URL against the URLPatterns, returning the first match found and
   * its associated value.
   *
   * The input is normalized once with the `URL` constructor and both pruning
   * and `exec()` consume the same normalized URL. Invalid input throws a
   * `TypeError`, including for an empty list; relative string input requires a
   * `baseUrl`.
   *
   * @param url - The URL to match
   * @param baseUrl - Optional base URL for relative path resolution
   */
  match(url: string | URL, baseUrl?: string): URLPatternListMatch<T> | null {
    const normalized = new URL(String(url), baseUrl);
    const fullURL = normalized.href;
    const fixed = this.#fixedCandidates(normalized);
    // Merge the fixed-tree candidates and the conservative candidates by
    // original sequence, so the first complete exec match in registration
    // order wins. Both arrays are already sorted by sequence.
    let fixedIndex = 0;
    let conservativeIndex = 0;
    while (
      fixedIndex < fixed.length ||
      conservativeIndex < this.#conservative.length
    ) {
      let item: URLPatternListItem<T>;
      if (fixedIndex >= fixed.length) {
        item = this.#conservative[conservativeIndex++];
      } else if (conservativeIndex >= this.#conservative.length) {
        item = fixed[fixedIndex++];
      } else if (
        fixed[fixedIndex].sequence <
        this.#conservative[conservativeIndex].sequence
      ) {
        item = fixed[fixedIndex++];
      } else {
        item = this.#conservative[conservativeIndex++];
      }
      // Pass baseUrl through to exec like upstream did, so the result's
      // `inputs` reflect the caller's arguments. The normalized URL is
      // absolute, so the base never changes whether exec matches.
      const result =
        baseUrl === undefined
          ? item.pattern.exec(fullURL)
          : item.pattern.exec(fullURL, baseUrl);
      if (result !== null) {
        return {result, value: item.value};
      }
    }
    return null;
  }

  /**
   * Diagnostic upper bound on the number of patterns that `match()` would
   * exec for the given input. Not part of the matching semantics; no matcher
   * internals are exposed.
   */
  candidateCount(url: string | URL, baseUrl?: string): number {
    const normalized = new URL(String(url), baseUrl);
    return this.#fixedCandidates(normalized).length + this.#conservative.length;
  }
}
