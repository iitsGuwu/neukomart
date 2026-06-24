import { useSyncExternalStore } from 'react';
import type {
  Listing,
  SwapOffer,
  ActivityItem,
  NeukoAsset,
  Offer,
} from './types';

/** Increment when the shape of MarketState changes to auto-clear stale caches. */
const STATE_VERSION = 8;

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
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as MarketState;
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

export function isSeeded(): boolean {
  return state.seeded;
}

/** Seed from the live on-chain indexer (real listings/offers/activity). */
export function seedFromIndexer(
  idx: { listings: Listing[]; offers: Offer[]; activity: ActivityItem[] },
  _assets: NeukoAsset[],
) {
  if (state.seeded) return;
  set({
    seeded: true,
    listings: idx.listings,
    offers: idx.offers,
    activity: idx.activity,
    swaps: [],
  });
}

/** Seed from live Magic Eden data (real listings + sales). */
export function seedFromLive(
  live: { listings: Listing[]; activity: ActivityItem[] },
  _assets: NeukoAsset[],
) {
  if (state.seeded) return;
  set({
    seeded: true,
    listings: live.listings,
    activity: live.activity,
    swaps: [],
    offers: [],
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

export function resetStore() {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  state = empty();
  emit();
}
