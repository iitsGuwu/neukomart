import { useSyncExternalStore } from 'react';
import type {
  Listing,
  SwapOffer,
  ActivityItem,
  NeukoAsset,
  Offer,
} from './types';

/** Increment when the shape of MarketState changes to auto-clear stale caches. */
const STATE_VERSION = 9;

interface MarketState {
  /** Schema version — used to detect stale localStorage caches. */
  _v: number;
  seeded: boolean;
  listings: Listing[];
  swaps: SwapOffer[];
  activity: ActivityItem[];
  offers: Offer[];
  /** asset id -> owner wallet (local ownership overrides). */
  ownership: Record<string, string>;
  diamondHands: Record<string, boolean>;
}

const STORAGE_KEY = 'neuko-market-state-v4';

function empty(): MarketState {
  return {
    _v: STATE_VERSION,
    seeded: false,
    listings: [],
    swaps: [],
    activity: [],
    offers: [],
    ownership: {},
    diamondHands: {},
  };
}

function load(): MarketState {
  // Only user-specific prefs (favorites) persist. Live market data —
  // listings / activity / offers — is ALWAYS re-fetched fresh on each load via
  // useSeedMarket, so a one-time stale or empty snapshot can never stick
  // (the previous "seed once and persist" behaviour left users with 0
  // listings whenever the first fetch raced or hiccupped).
  const base = empty();
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<MarketState>;
        if (parsed && parsed._v === STATE_VERSION && parsed.diamondHands) {
          base.diamondHands = parsed.diamondHands;
        }
      } catch {
        /* ignore malformed JSON */
      }
    }
  }
  return base;
}

let state: MarketState = load();
const listeners = new Set<() => void>();

function emit() {
  if (typeof localStorage !== 'undefined') {
    try {
      // Persist ONLY user prefs — never the live-derived market snapshot.
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ _v: STATE_VERSION, diamondHands: state.diamondHands }),
      );
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

export function isSeeded(): boolean {
  return state.seeded;
}

/** Seed the market once from the merged set of all live sources (NEUKO
 *  on-chain indexer + Magic Eden / Tensor aggregation). Replaces the old
 *  either/or seeds, which hid ME/Tensor listings the moment a single NEUKO
 *  listing existed. */
export function seedAll(data: { listings: Listing[]; offers: Offer[]; activity: ActivityItem[] }) {
  if (state.seeded) return;
  set({
    seeded: true,
    listings: data.listings,
    offers: data.offers,
    activity: data.activity,
    swaps: [],
  });
}

export function ownsAsset(_assetId: string, _wallet: string): boolean {
  return false;
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

/** Optimistic add/remove so the market grid updates instantly after an
 *  on-chain action — no page reload needed. The indexer will confirm on next
 *  seed; these keep the UI in sync in the meantime. */
export function addListing(listing: Listing) {
  set({ listings: [...state.listings.filter((l) => l.asset.id !== listing.asset.id), listing] });
}
export function removeListing(assetId: string) {
  set({ listings: state.listings.filter((l) => l.asset.id !== assetId) });
}
export function addOffer(offer: Offer) {
  set({ offers: [...state.offers.filter((o) => o.id !== offer.id), offer] });
}
export function removeOffer(offerId: string) {
  set({ offers: state.offers.filter((o) => o.id !== offerId) });
}

export function resetStore() {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  state = empty();
  emit();
}
