import type { NeukoAsset, Listing, Offer, ActivityItem, Currency } from './types';
import { collectionForAddress } from './constants';

/**
 * Frontend client for the on-chain indexer (`/api/market`). Returns real,
 * confirmed listings/offers/activity once the program is deployed and a Helius
 * webhook + KV store are configured. Falls back to null (→ demo data) when the
 * indexer isn't set up, so local dev and pre-launch keep working.
 */

interface RawListing {
  asset: string;
  seller: string;
  price: number;
  currency: Currency;
  createdAt: number;
}
interface RawOffer {
  id: string;
  bidder: string;
  collection: string;
  asset: string | null;
  amount: number;
  currency: Currency;
  createdAt: number;
}
interface RawActivity {
  id: string;
  kind: ActivityItem['kind'];
  asset?: string;
  price?: number;
  currency?: Currency;
  from?: string;
  to?: string;
  time: number;
}

export interface IndexedMarket {
  listings: Listing[];
  offers: Offer[];
  activity: ActivityItem[];
}

export async function loadIndexedMarket(
  assetMap: Map<string, NeukoAsset>,
): Promise<IndexedMarket | null> {
  let data: { configured?: boolean; listings: RawListing[]; offers: RawOffer[]; activity: RawActivity[] };
  try {
    const res = await fetch('/api/market', { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }
  if (!data.configured) return null;
  if (!data.listings?.length && !data.offers?.length) return null;

  const listings: Listing[] = (data.listings || [])
    .filter((l) => assetMap.has(l.asset))
    .map((l) => ({
      id: 'listing-' + l.asset,
      asset: assetMap.get(l.asset)!,
      seller: l.seller,
      price: l.price,
      currency: l.currency,
      origin: 'neukomart' as const,
      createdAt: l.createdAt,
    }));

  const offers: Offer[] = (data.offers || []).map((o) => {
    const a = o.asset ? assetMap.get(o.asset) : undefined;
    const meta = collectionForAddress(o.collection);
    return {
      id: o.id,
      bidder: o.bidder,
      collection: a?.collection ?? meta?.key ?? 'harmies',
      asset: o.asset ?? undefined,
      assetName: a?.name,
      image: a?.image,
      amount: o.amount,
      currency: o.currency,
      createdAt: o.createdAt,
      status: 'open',
    };
  });

  const activity: ActivityItem[] = (data.activity || []).map((a) => ({
    id: a.id,
    kind: a.kind,
    asset: a.asset ? assetMap.get(a.asset) : undefined,
    price: a.price,
    currency: a.currency,
    from: a.from,
    to: a.to,
    time: a.time,
  }));

  return { listings, offers, activity };
}
