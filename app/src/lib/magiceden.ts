import type { CollectionKey, } from './constants';
import type { MarketOrigin } from './types';

/**
 * Magic Eden marketplace data (aggregated across ME + Tensor via
 * `listingAggMode`). This is the live source of truth for listings, sales and
 * floor today — before the on-chain NEUKO program is deployed. Requests go
 * through the `/api/magiceden` proxy (Vite dev proxy locally, Vercel function in
 * prod) because ME's API sends no CORS headers.
 */

const ME_BASE = '/api/magiceden/v2';

export const ME_SYMBOL: Record<CollectionKey, string> = {
  harmies: 'harmies',
  // NOTE: the live Magic Eden symbol has a trailing underscore.
  badges: 'gboy_badges_',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function meFetch(url: string, attempts = 5): Promise<Response | null> {
  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { accept: 'application/json' } });
    } catch {
      if (i === attempts - 1) return null;
      await sleep(Math.min(700 * 2 ** i, 8000));
      continue;
    }
    if (res.status !== 429 && res.status !== 503) return res;
    if (i === attempts - 1) return res;
    const ra = parseInt(res.headers.get('Retry-After') || '', 10);
    await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(700 * 2 ** i + Math.random() * 400, 8000));
  }
  return null;
}

export interface MeListing {
  mint: string;
  price: number; // SOL
  seller: string;
  origin: MarketOrigin;
}

/** Map Magic Eden's `listingSource` to a marketplace origin. */
export function originFromSource(src?: string | null): MarketOrigin {
  const s = (src || '').toUpperCase();
  if (s.includes('TENSOR') || s === 'TCOMP' || s === 'TSWAP') return 'tensor';
  // M2, MMM (ME pools), MEAH, etc. are all Magic Eden.
  return 'magiceden';
}

/** All current listings for a collection, keyed by token mint. */
export async function fetchListings(collection: CollectionKey): Promise<MeListing[]> {
  const symbol = ME_SYMBOL[collection];
  const out: MeListing[] = [];
  const limit = 100;
  let offset = 0;
  for (let page = 0; page < 25; page++) {
    const res = await meFetch(
      `${ME_BASE}/collections/${symbol}/listings?offset=${offset}&limit=${limit}&listingAggMode=true`,
    );
    if (!res || !res.ok) break;
    const data = (await res.json()) as Array<{ tokenMint?: string; price?: number; seller?: string; listingSource?: string }>;
    if (!Array.isArray(data) || data.length === 0) break;
    for (const l of data) {
      if (l.tokenMint && typeof l.price === 'number') {
        out.push({ mint: l.tokenMint, price: l.price, seller: l.seller || '', origin: originFromSource(l.listingSource) });
      }
    }
    offset += data.length;
    if (data.length < limit) break;
    await sleep(150);
  }
  return out;
}

export interface MeSale {
  mint: string;
  price: number;
  buyer?: string;
  seller?: string;
  time: number; // unix seconds
}

/** Recent sale activities for a collection (most recent first). */
export async function fetchActivities(collection: CollectionKey, maxPages = 3): Promise<MeSale[]> {
  const symbol = ME_SYMBOL[collection];
  const out: MeSale[] = [];
  const limit = 100;
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await meFetch(`${ME_BASE}/collections/${symbol}/activities?offset=${offset}&limit=${limit}`);
    if (!res || !res.ok) break;
    const data = (await res.json()) as Array<{
      type?: string;
      tokenMint?: string;
      price?: number;
      buyer?: string;
      seller?: string;
      blockTime?: number;
    }>;
    if (!Array.isArray(data) || data.length === 0) break;
    for (const a of data) {
      if ((a.type === 'buyNow' || a.type === 'buy') && a.tokenMint) {
        out.push({
          mint: a.tokenMint,
          price: a.price || 0,
          buyer: a.buyer,
          seller: a.seller,
          time: a.blockTime || Math.floor(Date.now() / 1000),
        });
      }
    }
    offset += data.length;
    if (data.length < limit) break;
    await sleep(150);
  }
  return out;
}

export interface MeStats {
  floor: number | null; // SOL
  volumeAll: number; // SOL
  listed: number;
}

export async function fetchStats(collection: CollectionKey): Promise<MeStats | null> {
  const res = await meFetch(`${ME_BASE}/collections/${ME_SYMBOL[collection]}/stats`);
  if (!res || !res.ok) return null;
  const d = (await res.json()) as { floorPrice?: number; volumeAll?: number; listedCount?: number };
  return {
    floor: typeof d.floorPrice === 'number' ? d.floorPrice / 1e9 : null,
    volumeAll: typeof d.volumeAll === 'number' ? d.volumeAll / 1e9 : 0,
    listed: d.listedCount ?? 0,
  };
}
