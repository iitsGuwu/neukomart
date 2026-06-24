import { seededRandom } from './format';
import type { NeukoAsset, Listing, SwapOffer, ActivityItem, Currency, Offer } from './types';

/**
 * Builds a realistic marketplace state (listings / swaps / activity) on top of
 * REAL on-chain assets. Deterministic per asset id, so it is stable across
 * reloads. This is the demo market layer that stands in until the on-chain
 * program is deployed — every NFT referenced is genuine (real id, art, traits).
 */

function fakeWallet(rnd: () => number): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 44; i++) s += chars[Math.floor(rnd() * chars.length)];
  return s;
}

export function priceFor(a: NeukoAsset, currency: Currency): number {
  const rnd = seededRandom('price:' + a.id + currency);
  if (currency === 'sol') {
    const base = a.collection === 'harmies' ? 0.6 : 0.2;
    return +(base + rnd() * (a.collection === 'harmies' ? 2.4 : 1.1)).toFixed(2);
  }
  const base = a.collection === 'harmies' ? 4000 : 1200;
  return Math.round(base + rnd() * (a.collection === 'harmies' ? 16000 : 6000));
}

/** Stable 0..99 bucket from an id. */
function bucket(id: string): number {
  const rnd = seededRandom('bucket:' + id);
  return Math.floor(rnd() * 100);
}

export interface BuiltMarket {
  listings: Listing[];
  swaps: SwapOffer[];
  activity: ActivityItem[];
  offers: Offer[];
}

export function buildMarket(assets: NeukoAsset[]): BuiltMarket {
  if (assets.length === 0) return { listings: [], swaps: [], activity: [], offers: [] };

  const rootRnd = seededRandom('neuko-market-v2');
  const sellers = Array.from({ length: 8 }, () => fakeWallet(rootRnd));

  // ~14% of the collection is actively listed.
  const listedAssets = assets.filter((a) => bucket(a.id) < 14);

  const now = Math.floor(Date.now() / 1000);

  const listings: Listing[] = listedAssets.map((asset, i) => {
    const rnd = seededRandom('listing:' + asset.id);
    const currency: Currency = rnd() < 0.34 ? 'gboy' : 'sol';
    return {
      id: 'listing-' + asset.id,
      asset,
      seller: sellers[Math.floor(rnd() * sellers.length)],
      price: priceFor(asset, currency),
      currency,
      origin: 'neukomart' as const,
      createdAt: now - Math.floor(rnd() * 7 * 86400),
      demo: true,
    };
  });

  // A handful of open barter offers across real assets.
  const harmies = assets.filter((a) => a.collection === 'harmies');
  const badges = assets.filter((a) => a.collection === 'badges');
  const pick = (arr: NeukoAsset[], n: number, salt: string) => {
    const rnd = seededRandom('pick:' + salt);
    const pool = [...arr];
    const out: NeukoAsset[] = [];
    for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    return out;
  };

  const swaps: SwapOffer[] = [];
  if (harmies.length && badges.length) {
    const s = (
      id: string,
      give: NeukoAsset[],
      want: NeukoAsset[],
      giveSol = 0,
      giveGboy = 0,
      wantSol = 0,
      wantGboy = 0,
      ageH = 2,
    ): SwapOffer => ({
      id,
      maker: sellers[(swaps.length + 1) % sellers.length],
      give: { assets: give, sol: giveSol, gboy: giveGboy },
      want: { assets: want, sol: wantSol, gboy: wantGboy },
      createdAt: now - ageH * 3600,
      status: 'open',
      demo: true,
    });
    swaps.push(
      s('swap-1', pick(harmies, 1, 'a'), pick(badges, 2, 'b'), 0, 0, 0, 0, 1),
      s('swap-2', pick(badges, 1, 'c'), pick(harmies, 1, 'd'), 0, 2500, 0, 0, 3),
      s('swap-3', pick(harmies, 2, 'e'), pick(harmies, 1, 'f'), 0, 0, 1.5, 0, 5),
      s('swap-4', pick(badges, 1, 'g'), pick(badges, 2, 'h'), 0.25, 0, 0, 0, 8),
      s('swap-5', pick(harmies, 1, 'i'), pick(badges, 1, 'j'), 0, 0, 0, 3000, 11),
    );
  }

  const actKinds = ['sale', 'list', 'swap', 'offer'] as const;
  const activity: ActivityItem[] = assets.slice(0, 22).map((a, i) => {
    const kind = actKinds[i % actKinds.length];
    const currency: Currency = i % 2 === 0 ? 'sol' : 'gboy';
    return {
      id: 'act-' + a.id,
      kind,
      asset: a,
      price: kind === 'sale' || kind === 'list' ? priceFor(a, currency) : undefined,
      currency: kind === 'sale' || kind === 'list' ? currency : undefined,
      from: sellers[i % sellers.length],
      to: kind === 'sale' ? sellers[(i + 1) % sellers.length] : undefined,
      time: now - i * 1500 - 120,
    };
  });

  // Standing offers/bids on real assets (a few specific + a collection floor bid).
  const offers: Offer[] = [];
  const offerTargets = pick(assets, 5, 'offers');
  offerTargets.forEach((a, i) => {
    const rnd = seededRandom('offer:' + a.id);
    const currency: Currency = rnd() < 0.4 ? 'gboy' : 'sol';
    const list = priceFor(a, currency);
    offers.push({
      id: 'offer-' + a.id,
      bidder: sellers[(i + 3) % sellers.length],
      collection: a.collection,
      asset: a.id,
      assetName: a.name,
      image: a.image,
      amount: currency === 'sol' ? +(list * 0.85).toFixed(2) : Math.round(list * 0.85),
      currency,
      createdAt: now - i * 5400 - 800,
      status: 'open',
      demo: true,
    });
  });
  // one collection-wide floor bid
  if (harmies.length) {
    offers.push({
      id: 'offer-floor-harmies',
      bidder: sellers[2],
      collection: 'harmies',
      amount: 0.45,
      currency: 'sol',
      createdAt: now - 3600,
      status: 'open',
      demo: true,
    });
  }

  return { listings, swaps, activity, offers };
}
