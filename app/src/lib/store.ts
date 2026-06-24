import { useSyncExternalStore } from 'react';
import { buildMarket } from './market-data';
import { ALL_ASSETS } from './seed';
import { seededRandom } from './format';
import type {
  Listing,
  SwapOffer,
  ActivityItem,
  NeukoAsset,
  Currency,
  SwapSide,
  Offer,
} from './types';
import type { CollectionKey } from './constants';

/**
 * Global store backing the marketplace. Listings / swaps / activity are seeded
 * from REAL on-chain assets (see `seedMarket`), then user actions (list / buy /
 * swap) mutate this store locally and are clearly labelled as simulated until
 * the on-chain program is deployed.
 */

/** Increment when the shape of MarketState changes to auto-clear stale caches. */
const STATE_VERSION = 7;

interface MarketState {
  /** Schema version — used to detect stale localStorage caches. */
  _v: number;
  seeded: boolean;
  /** True when the persisted seed is the offline DEMO fallback (live data was
   *  unreachable). Treated as "not finally seeded" so the next page load
   *  re-attempts live data and self-heals once the feed is reachable again. */
  demoSeed: boolean;
  listings: Listing[];
  swaps: SwapOffer[];
  activity: ActivityItem[];
  offers: Offer[];
  /** asset id -> owner wallet (local ownership overrides from sim actions). */
  ownership: Record<string, string>;
  diamondHands: Record<string, boolean>;
}

const STORAGE_KEY = 'neuko-market-state-v4';

function empty(): MarketState {
  return { _v: STATE_VERSION, seeded: false, demoSeed: false, listings: [], swaps: [], activity: [], offers: [], ownership: {}, diamondHands: {} };
}

function load(): MarketState {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as MarketState;
        // M-3: Reject stale state with a different schema version.
        if (parsed._v !== STATE_VERSION) {
          localStorage.removeItem(STORAGE_KEY);
          return empty();
        }
        return parsed;
      } catch {
        /* ignore malformed JSON */
      }
    }
  }
  return empty();
}

let state: MarketState = load();
const listeners = new Set<() => void>();

function emit() {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota / serialization — non-fatal */
    }
  }
  listeners.forEach((l) => l());
}

function set(next: Partial<MarketState>) {
  state = { ...state, ...next };
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useMarketState(): MarketState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** "Finally" seeded — a DEMO fallback seed returns false so the next load
 *  retries live data (see `demoSeed`). */
export function isSeeded(): boolean {
  return state.seeded && !state.demoSeed;
}

/** Offline DEMO seed from real assets — used only when both the indexer and the
 *  live feed are unreachable. Marked `demoSeed` so a later load can upgrade it
 *  to live data. */
export function seedMarket(assets: NeukoAsset[]) {
  if (state.seeded || assets.length === 0) return;
  const built = buildMarket(assets);
  set({
    seeded: true,
    demoSeed: true,
    listings: built.listings,
    swaps: built.swaps,
    activity: built.activity,
    offers: built.offers,
  });
}

/** Seed from the live on-chain indexer (real listings/offers/activity). Swaps
 *  fall back to the demo set until on-chain swap indexing is added. */
export function seedFromIndexer(
  idx: { listings: Listing[]; offers: Offer[]; activity: ActivityItem[] },
  assets: NeukoAsset[],
) {
  // A prior DEMO seed may be upgraded to live; a prior live seed is kept.
  if (state.seeded && !state.demoSeed) return;
  const demo = buildMarket(assets);
  set({
    seeded: true,
    demoSeed: false,
    listings: idx.listings,
    offers: idx.offers,
    activity: idx.activity.length ? idx.activity : demo.activity,
    swaps: demo.swaps,
  });
}

/** Seed from live Magic Eden data (real listings + sales). Swaps/offers fall
 *  back to the demo set (those are NEUKO-native, not on ME). */
export function seedFromLive(
  live: { listings: Listing[]; activity: ActivityItem[] },
  assets: NeukoAsset[],
) {
  // A prior DEMO seed may be upgraded to live; a prior live seed is kept.
  if (state.seeded && !state.demoSeed) return;
  const demo = buildMarket(assets);
  set({
    seeded: true,
    demoSeed: false,
    listings: live.listings,
    activity: live.activity.length ? live.activity : demo.activity,
    swaps: demo.swaps,
    offers: demo.offers,
  });
}

function pushActivity(item: Omit<ActivityItem, 'id' | 'time'>) {
  const a: ActivityItem = {
    ...item,
    id: 'act-' + Math.random().toString(36).slice(2),
    time: Math.floor(Date.now() / 1000),
  };
  set({ activity: [a, ...state.activity].slice(0, 80) });
}

// --------------------------- demo ownership --------------------------------

/** Deterministic fallback inventory (only used when DAS is unavailable). */
export function demoInventory(wallet: string): NeukoAsset[] {
  const rnd = seededRandom('inv:' + wallet);
  const pool = [...ALL_ASSETS];
  const picks: NeukoAsset[] = [];
  const n = 6 + Math.floor(rnd() * 4);
  for (let i = 0; i < n && pool.length; i++) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return picks.map((a) => ({ ...a, owner: wallet }));
}

export function ownsAsset(assetId: string, wallet: string): boolean {
  return state.ownership[assetId] === wallet;
}

// ------------------------------- actions -----------------------------------

/** Max price/amount accepted in the demo store (prevents absurd numbers in state). */
const MAX_PRICE = 1_000_000_000;

export function createListing(asset: NeukoAsset, price: number, currency: Currency, seller: string) {
  // Sanity-check price before inserting into persisted state.
  if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) return;
  const listing: Listing = {
    id: 'listing-' + asset.id,
    asset: { ...asset, owner: seller },
    seller,
    price,
    currency,
    origin: 'neukomart',
    createdAt: Math.floor(Date.now() / 1000),
    demo: true,
  };
  set({
    listings: [listing, ...state.listings.filter((l) => l.asset.id !== asset.id)],
    ownership: { ...state.ownership, [asset.id]: seller },
  });
  pushActivity({ kind: 'list', asset, price, currency, from: seller });
}

export function cancelListing(assetId: string) {
  set({ listings: state.listings.filter((l) => l.asset.id !== assetId) });
}

export function buyListing(listingId: string, buyer: string) {
  const listing = state.listings.find((l) => l.id === listingId);
  if (!listing) return;
  set({
    listings: state.listings.filter((l) => l.id !== listingId),
    ownership: { ...state.ownership, [listing.asset.id]: buyer },
  });
  pushActivity({
    kind: 'sale',
    asset: listing.asset,
    price: listing.price,
    currency: listing.currency,
    from: listing.seller,
    to: buyer,
  });
}

let swapNonce = Date.now();
export function createSwap(give: SwapSide, want: SwapSide, maker: string, taker?: string, counteredFrom?: string) {
  const offer: SwapOffer = {
    id: 'swap-' + (++swapNonce).toString(36),
    maker,
    taker,
    give,
    want,
    createdAt: Math.floor(Date.now() / 1000),
    status: 'open',
    demo: true,
    counteredFrom,
  };
  // A counter supersedes the offer it responds to.
  const swaps = counteredFrom
    ? state.swaps.map((s) => (s.id === counteredFrom ? { ...s, status: 'cancelled' as const } : s))
    : state.swaps;
  set({ swaps: [offer, ...swaps] });
  pushActivity({ kind: counteredFrom ? 'offer' : 'swap', asset: give.assets[0] ?? want.assets[0], from: maker });
}

export function acceptSwap(swapId: string, taker: string) {
  const offer = state.swaps.find((s) => s.id === swapId);
  if (!offer) return;
  const ownership = { ...state.ownership };
  offer.give.assets.forEach((a) => (ownership[a.id] = taker));
  offer.want.assets.forEach((a) => (ownership[a.id] = offer.maker));
  // Any swapped asset that was listed is now delisted.
  const swappedIds = new Set([...offer.give.assets, ...offer.want.assets].map((a) => a.id));
  set({
    swaps: state.swaps.map((s) => (s.id === swapId ? { ...s, status: 'accepted' } : s)),
    listings: state.listings.filter((l) => !swappedIds.has(l.asset.id)),
    ownership,
  });
  pushActivity({ kind: 'swap', asset: offer.give.assets[0] ?? offer.want.assets[0], from: offer.maker, to: taker });
}

export function cancelSwap(swapId: string) {
  set({
    swaps: state.swaps.map((s) => (s.id === swapId ? { ...s, status: 'cancelled' } : s)),
  });
}

// ------------------------------- offers ------------------------------------

let offerNonce = Date.now();
export function createOffer(
  bidder: string,
  collection: CollectionKey,
  amount: number,
  currency: Currency,
  target?: NeukoAsset,
) {
  // Sanity-check amount before inserting into persisted state.
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PRICE) return;
  const offer: Offer = {
    id: 'offer-' + (++offerNonce).toString(36),
    bidder,
    collection,
    asset: target?.id,
    assetName: target?.name,
    image: target?.image,
    amount,
    currency,
    createdAt: Math.floor(Date.now() / 1000),
    status: 'open',
    demo: true,
  };
  set({ offers: [offer, ...state.offers] });
  pushActivity({ kind: 'offer', asset: target, price: amount, currency, from: bidder });
}

export function cancelOffer(offerId: string) {
  set({ offers: state.offers.map((o) => (o.id === offerId ? { ...o, status: 'cancelled' } : o)) });
}

export function acceptOffer(offerId: string, seller: string, asset: NeukoAsset) {
  const offer = state.offers.find((o) => o.id === offerId);
  if (!offer) return;
  set({
    offers: state.offers.map((o) => (o.id === offerId ? { ...o, status: 'accepted' } : o)),
    // If the asset was listed, selling it into the offer delists it.
    listings: state.listings.filter((l) => l.asset.id !== asset.id),
    ownership: { ...state.ownership, [asset.id]: offer.bidder },
  });
  pushActivity({ kind: 'sale', asset, price: offer.amount, currency: offer.currency, from: seller, to: offer.bidder });
}

export function toggleDiamondHand(assetId: string) {
  const next = { ...state.diamondHands };
  if (next[assetId]) {
    delete next[assetId];
  } else {
    next[assetId] = true;
  }
  set({ diamondHands: next });
}

export function isDiamondHand(assetId: string): boolean {
  return !!state.diamondHands?.[assetId];
}

export function resetStore() {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  state = empty();
  emit();
}
