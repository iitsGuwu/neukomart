import { fetchListings, fetchActivities } from './magiceden';
import type { CollectionKey } from './constants';
import type { NeukoAsset, Listing, ActivityItem } from './types';

/**
 * Builds the marketplace's live listings + sales from Magic Eden (aggregated
 * across marketplaces), joined with on-chain metadata from DAS. This is the real
 * source of truth for prices today; once the NEUKO program is deployed the
 * on-chain indexer takes over (see `lib/indexer.ts`).
 */

export interface LiveMarket {
  listings: Listing[];
  activity: ActivityItem[];
}

const COLLECTIONS: CollectionKey[] = ['harmies', 'badges'];

export async function loadLiveMarket(assetMap: Map<string, NeukoAsset>): Promise<LiveMarket | null> {
  let reachable = false;
  const listings: Listing[] = [];
  const sales: ActivityItem[] = [];
  const now = Math.floor(Date.now() / 1000);

  try {
    const results = await Promise.all(
      COLLECTIONS.map(async (c) => ({
        c,
        ls: await fetchListings(c),
        acts: await fetchActivities(c),
      })),
    );

    for (const { ls, acts } of results) {
      reachable = true;
      for (const l of ls) {
        const asset = assetMap.get(l.mint);
        if (!asset) continue;
        listings.push({
          id: 'listing-' + l.mint,
          asset,
          seller: l.seller,
          price: +l.price.toFixed(3),
          currency: 'sol',
          origin: l.origin,
          createdAt: now,
        });
      }
      for (const s of acts) {
        const asset = assetMap.get(s.mint);
        if (!asset) continue;
        sales.push({
          id: 'me-' + s.mint + '-' + s.time,
          kind: 'sale',
          asset,
          price: +s.price.toFixed(3),
          currency: 'sol',
          from: s.seller,
          to: s.buyer,
          time: s.time,
        });
      }
    }
  } catch {
    return null;
  }

  // Couldn't reach ME, or nothing live to show → let the caller fall back.
  if (!reachable || (listings.length === 0 && sales.length === 0)) return null;

  listings.sort((a, b) => a.price - b.price);
  sales.sort((a, b) => b.time - a.time);
  return { listings, activity: sales.slice(0, 60) };
}
