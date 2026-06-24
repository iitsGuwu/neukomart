import { seededRandom } from './format';
import type { CollectionKey } from './constants';
import type { Listing } from './types';

/**
 * Time-series for the Activity analytics view (volume + floor history).
 *
 * Until the on-chain program is deployed and the indexer has real history, this
 * synthesizes a plausible, deterministic series anchored to the CURRENT floor
 * derived from live listings — so the charts read realistically. Once the
 * indexer serves historical events, swap these for the real aggregates.
 */

export interface Point {
  t: number; // unix ms
  v: number;
}

const DAY = 86_400_000;

export function currentFloor(listings: Listing[], collection: CollectionKey): number {
  const sols = listings
    .filter((l) => l.asset.collection === collection && l.currency === 'sol')
    .map((l) => l.price);
  if (sols.length) return Math.min(...sols);
  return collection === 'harmies' ? 0.6 : 0.2;
}

/** Floor price (SOL) per day for a collection, ending at the live floor. */
export function floorHistory(listings: Listing[], collection: CollectionKey, days: number): Point[] {
  const floor = currentFloor(listings, collection);
  const rnd = seededRandom('floor:' + collection + ':' + days);
  const now = Date.now();
  const out: Point[] = [];
  let v = floor * (0.55 + rnd() * 0.35);
  for (let d = days - 1; d >= 0; d--) {
    v = Math.max(0.02, v * (0.93 + rnd() * 0.17)); // gentle random walk, slight uptrend
    out.push({ t: now - d * DAY, v: +v.toFixed(3) });
  }
  if (out.length) out[out.length - 1].v = +floor.toFixed(3); // anchor to live floor
  return out;
}

/** Daily trading volume (SOL-equivalent) across the ecosystem. */
export function volumeHistory(days: number): Point[] {
  const rnd = seededRandom('volume:' + days);
  const now = Date.now();
  const out: Point[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const weekend = new Date(now - d * DAY).getDay();
    const boost = weekend === 0 || weekend === 6 ? 1.4 : 1;
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
