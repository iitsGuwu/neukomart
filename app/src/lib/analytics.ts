import { seededRandom } from './format';
import type { CollectionKey } from './constants';
import type { ActivityItem, Listing } from './types';

/**
 * Time-series for the Activity analytics view (volume + floor history).
 *
 * These are built from REAL indexed sale activity (Magic Eden aggregation today,
 * the on-chain indexer once the program has trade history). When no real sales
 * exist yet in the selected window we fall back to a deterministic, plausible
 * curve anchored to the live floor — clearly disclaimed in the UI — so the
 * charts aren't blank pre-launch. `hasRealHistory` lets the page say which.
 */

export interface Point {
  t: number; // unix ms
  v: number;
}

const DAY = 86_400_000;

/** Sale activity within the window that contributes to the SOL volume metric. */
function solSales(activity: ActivityItem[], days: number): ActivityItem[] {
  const cutoff = Math.floor((Date.now() - days * DAY) / 1000);
  return activity.filter(
    (a) => a.kind === 'sale' && a.currency === 'sol' && typeof a.price === 'number' && a.time >= cutoff,
  );
}

/** True when there is at least one real SOL sale in the window. */
export function hasRealHistory(activity: ActivityItem[], days: number): boolean {
  return solSales(activity, days).length > 0;
}

export function currentFloor(listings: Listing[], collection: CollectionKey): number {
  const sols = listings
    .filter((l) => l.asset.collection === collection && l.currency === 'sol')
    .map((l) => l.price);
  if (sols.length) return Math.min(...sols);
  return collection === 'harmies' ? 0.6 : 0.2;
}

/** Index of the day-bucket (0 = oldest in window, days-1 = today) for a sale. */
function dayBucket(unixSeconds: number, days: number): number {
  const ageDays = Math.floor((Date.now() - unixSeconds * 1000) / DAY);
  return days - 1 - ageDays;
}

/** Daily trading volume (SOL). Real when sales exist, else a modelled curve. */
export function floorHistory(
  listings: Listing[],
  activity: ActivityItem[],
  collection: CollectionKey,
  days: number,
): Point[] {
  const floor = currentFloor(listings, collection);
  const now = Date.now();

  // Real path: daily minimum sale price for this collection, carried forward
  // across days with no sales, with the final point anchored to the live floor.
  const sales = solSales(activity, days).filter((a) => a.asset?.collection === collection);
  if (sales.length) {
    const dailyMin = new Array<number | undefined>(days);
    for (const s of sales) {
      const i = dayBucket(s.time, days);
      if (i < 0 || i >= days) continue;
      if (dailyMin[i] === undefined || s.price! < dailyMin[i]!) dailyMin[i] = s.price!;
    }
    const out: Point[] = [];
    let last = dailyMin.find((v) => v !== undefined) ?? floor;
    for (let i = 0; i < days; i++) {
      if (dailyMin[i] !== undefined) last = dailyMin[i]!;
      out.push({ t: now - (days - 1 - i) * DAY, v: +last.toFixed(3) });
    }
    if (out.length) out[out.length - 1].v = +floor.toFixed(3);
    return out;
  }

  // Fallback: deterministic curve anchored to the live floor (disclaimed in UI).
  const rnd = seededRandom('floor:' + collection + ':' + days);
  const out: Point[] = [];
  let v = floor * (0.55 + rnd() * 0.35);
  for (let d = days - 1; d >= 0; d--) {
    v = Math.max(0.02, v * (0.93 + rnd() * 0.17));
    out.push({ t: now - d * DAY, v: +v.toFixed(3) });
  }
  if (out.length) out[out.length - 1].v = +floor.toFixed(3);
  return out;
}

/** Daily SOL trading volume. Real when sales exist, else a modelled curve. */
export function volumeHistory(activity: ActivityItem[], days: number): Point[] {
  const now = Date.now();
  const sales = solSales(activity, days);

  if (sales.length) {
    const buckets = new Array<number>(days).fill(0);
    for (const s of sales) {
      const i = dayBucket(s.time, days);
      if (i >= 0 && i < days) buckets[i] += s.price!;
    }
    return buckets.map((v, i) => ({ t: now - (days - 1 - i) * DAY, v: +v.toFixed(2) }));
  }

  // Fallback: deterministic plausible volume (disclaimed in UI).
  const rnd = seededRandom('volume:' + days);
  const out: Point[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const dow = new Date(now - d * DAY).getDay();
    const boost = dow === 0 || dow === 6 ? 1.4 : 1;
    out.push({ t: now - d * DAY, v: +((6 + rnd() * 38) * boost).toFixed(1) });
  }
  return out;
}

export function sumVolume(points: Point[]): number {
  return points.reduce((a, p) => a + p.v, 0);
}

export function pctChange(points: Point[]): number {
  if (points.length < 2) return 0;
  const a = points[0].v;
  const b = points[points.length - 1].v;
  return a === 0 ? 0 : ((b - a) / a) * 100;
}
