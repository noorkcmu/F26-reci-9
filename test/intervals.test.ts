import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mergeIntervals, type Interval } from '../src/intervals';

// Read the spec in src/intervals/mergeIntervals.ts, then check your progress
// with `npm run mutants:intervals`.
//
// Label every property with its pattern, on the line above its `it(`:
//   // Pattern: invariant. The output is sorted.
// (invariant, algebraic, metamorphic, differential, or conditional)

// Valid intervals are built, not filtered: order the two endpoints so start <= end.
// A small range makes shared endpoints, overlaps and duplicates common.
const endpoint = fc.integer({ min: -20, max: 20 });
const interval: fc.Arbitrary<Interval> = fc
  .tuple(endpoint, endpoint)
  .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as Interval);
const intervalList = fc.array(interval, { maxLength: 10 });

// Disjoint, non-touching intervals: each start is at least 1 past the previous end.
// Built in sorted order, then shuffled so the input order is arbitrary.
const disjointSorted: fc.Arbitrary<Interval[]> = fc
  .tuple(endpoint, fc.array(fc.tuple(fc.nat(4), fc.nat(4)), { maxLength: 8 }))
  .map(([first, steps]) => {
    const out: Interval[] = [];
    let prevEnd = first - 1;
    for (const [gap, len] of steps) {
      const start = prevEnd + 1 + gap;
      out.push([start, start + len]);
      prevEnd = start + len;
    }
    return out;
  });
const disjointShuffled = disjointSorted.chain(sorted =>
  fc
    .shuffledSubarray(sorted, { minLength: sorted.length, maxLength: sorted.length })
    .map(shuffled => ({ sorted, shuffled })),
);

// An invalid interval: start > end, or a non-integer endpoint.
const badInterval: fc.Arbitrary<Interval> = fc.oneof(
  fc.tuple(endpoint, fc.integer({ min: 1, max: 5 })).map(([s, d]) => [s, s - d] as Interval),
  interval.map(([s, e]) => [s + 0.5, e + 1] as Interval),
  interval.map(([s, e]) => [s, e + 0.5] as Interval),
);

// Is point p covered by some interval in xs? Obviously correct, no merging logic.
const covers = (xs: readonly Interval[], p: number) => xs.some(([s, e]) => s <= p && p <= e);

// Every integer and every half-integer around the generated range, so gaps
// like 2 < x < 3 between [1, 2] and [3, 4] are probed too.
const probePoints: number[] = [];
for (let p = -22; p <= 22; p += 0.5) probePoints.push(p);

describe('mergeIntervals', () => {
  // Pattern: invariant. Every input interval lies inside some output interval.
  it('every input interval lies inside some output interval', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        const uncovered = xs.filter(([s, e]) => !out.some(([a, b]) => a <= s && e <= b));
        expect(uncovered).toEqual([]);
      }),
    );
  });

  // Pattern: invariant. Each output interval is valid, the output is sorted, and consecutive intervals neither overlap nor touch.
  it('output intervals are valid, sorted, and separated by gaps', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        for (const [s, e] of out) {
          expect(Number.isInteger(s) && Number.isInteger(e) && s <= e).toBe(true);
        }
        for (let i = 0; i + 1 < out.length; i++) {
          expect(out[i][1]).toBeLessThan(out[i + 1][0]);
        }
      }),
    );
  });

  // Pattern: invariant. The input array and the intervals in it are not modified.
  it('does not modify the input', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const copy = xs.map(([s, e]) => [s, e]);
        mergeIntervals(xs);
        expect(xs).toEqual(copy);
      }),
    );
  });

  // Pattern: differential. A point is covered by the output exactly when it is covered by the input.
  it('covers exactly the same points as the input', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        for (const p of probePoints) {
          expect(covers(out, p), `point ${p}`).toBe(covers(xs, p));
        }
      }),
    );
  });

  // Pattern: metamorphic. Reordering the input, or duplicating an interval, does not change the output.
  it('is unaffected by input order and duplicates', () => {
    fc.assert(
      fc.property(
        intervalList.chain(xs =>
          fc.tuple(
            fc.constant(xs),
            fc.shuffledSubarray(xs, { minLength: xs.length, maxLength: xs.length }),
          ),
        ),
        ([xs, shuffled]) => {
          const expected = mergeIntervals(xs);
          expect(mergeIntervals(shuffled)).toEqual(expected);
          expect(mergeIntervals([...shuffled, ...xs])).toEqual(expected);
        },
      ),
    );
  });

  // Pattern: algebraic. Merging is idempotent: merging an already-merged list changes nothing.
  it('merging twice is the same as merging once', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const once = mergeIntervals(xs);
        expect(mergeIntervals(once)).toEqual(once);
      }),
    );
  });

  // Pattern: conditional. If no two input intervals overlap or touch, the output is the input sorted by start.
  it('leaves disjoint, non-touching intervals unchanged apart from sorting', () => {
    fc.assert(
      fc.property(disjointShuffled, ({ sorted, shuffled }) => {
        expect(mergeIntervals(shuffled)).toEqual(sorted);
      }),
    );
  });

  // Pattern: conditional. If any input interval is invalid, a RangeError is thrown.
  it('throws a RangeError when any interval is invalid', () => {
    fc.assert(
      fc.property(intervalList, badInterval, fc.nat(), (xs, bad, i) => {
        const withBad = [...xs];
        withBad.splice(i % (xs.length + 1), 0, bad);
        expect(() => mergeIntervals(withBad)).toThrow(RangeError);
      }),
    );
  });

  // Pattern: conditional. The empty list merges to the empty list.
  it('[] gives []', () => {
    expect(mergeIntervals([])).toEqual([]);
  });
});
