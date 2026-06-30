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
  /** Offer ids the user has dismissed from their "Offers on your items" inbox.
   *  A denial is local-only: an owner cannot cancel a bidder's escrowed offer
   *  on-chain (only the bidder can withdraw), so this just hides it for them. */
  deniedOffers: Record<string, true>;
  /** Swap ids the user has refused from their incoming swap list. Local-only for
   *  the same reason — only the maker can cancel their swap escrow on-chain. */
  deniedSwaps: Record<string, true>;
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
    deniedOffers: {},
    deniedSwaps: {},
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
        if (parsed && parsed._v === STATE_VERSION) {
          if (parsed.diamondHands) base.diamondHands = parsed.diamondHands;
          if (parsed.deniedOffers) base.deniedOffers = parsed.deniedOffers;
          if (parsed.deniedSwaps) base.deniedSwaps = parsed.deniedSwaps;
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
        JSON.stringify({ _v: STATE_VERSION, diamondHands: state.diamondHands, deniedOffers: state.deniedOffers, deniedSwaps: state.deniedSwaps }),
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

// ── Optimistic overrides ────────────────────────────────────────────────────
// After an on-chain action we mutate the store immediately (addListing etc.) so
// the UI updates without a reload. The indexer confirms on the next refresh, but
// it lags (webhook delivery), so a refresh that arrived before the indexer
// caught up would otherwise resurrect a just-cancelled listing. We remember each
// optimistic op for a short TTL and re-apply it over every fresh fetch.
const OPTIMISTIC_TTL = 90_000;
const pendingListings = new Map<string, { listing: Listing | null; at: number }>();
const pendingOffers = new Map<string, { offer: Offer | null; at: number }>();

function prunePending() {
  const cut = Date.now() - OPTIMISTIC_TTL;
  for (const [k, v] of pendingListings) if (v.at < cut) pendingListings.delete(k);
  for (const [k, v] of pendingOffers) if (v.at < cut) pendingOffers.delete(k);
}

function applyPendingListings(list: Listing[]): Listing[] {
  prunePending();
  const map = new Map(list.map((l) => [l.asset.id, l]));
  for (const [id, v] of pendingListings) {
    if (v.listing) map.set(id, v.listing);
    else map.delete(id);
  }
  return [...map.values()];
}
function applyPendingOffers(offs: Offer[]): Offer[] {
  prunePending();
  const map = new Map(offs.map((o) => [o.id, o]));
  for (const [id, v] of pendingOffers) {
    if (v.offer) map.set(id, v.offer);
    else map.delete(id);
  }
  return [...map.values()];
}

/** Seed the market once from the merged set of all live sources (NEUKO
 *  on-chain indexer + Magic Eden / Tensor aggregation). Replaces the old
 *  either/or seeds, which hid ME/Tensor listings the moment a single NEUKO
 *  listing existed. */
export function seedAll(data: { listings: Listing[]; offers: Offer[]; activity: ActivityItem[] }) {
  if (state.seeded) return;
  set({
    seeded: true,
    listings: applyPendingListings(data.listings),
    offers: applyPendingOffers(data.offers),
    activity: data.activity,
    swaps: [],
  });
}

/** Re-seed an already-seeded market from a fresh fetch (polling / window focus).
 *  Optimistic in-flight mutations are preserved within their TTL so a lagging
 *  indexer can't undo a just-completed action. */
export function reseedAll(data: { listings: Listing[]; offers: Offer[]; activity: ActivityItem[] }) {
  set({
    seeded: true,
    listings: applyPendingListings(data.listings),
    offers: applyPendingOffers(data.offers),
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
  pendingListings.set(listing.asset.id, { listing, at: Date.now() });
  set({ listings: [...state.listings.filter((l) => l.asset.id !== listing.asset.id), listing] });
}
export function removeListing(assetId: string) {
  pendingListings.set(assetId, { listing: null, at: Date.now() });
  set({ listings: state.listings.filter((l) => l.asset.id !== assetId) });
}
export function addOffer(offer: Offer) {
  pendingOffers.set(offer.id, { offer, at: Date.now() });
  set({ offers: [...state.offers.filter((o) => o.id !== offer.id), offer] });
}
export function removeOffer(offerId: string) {
  pendingOffers.set(offerId, { offer: null, at: Date.now() });
  set({ offers: state.offers.filter((o) => o.id !== offerId) });
}

/** Locally dismiss an incoming offer from the owner's inbox. Does NOT touch the
 *  on-chain escrow (only the bidder can withdraw); it just hides it for this
 *  user. Persisted so a denied offer stays hidden across reloads. */
export function denyOffer(offerId: string) {
  if (state.deniedOffers[offerId]) return;
  set({ deniedOffers: { ...state.deniedOffers, [offerId]: true } });
}
export function undenyOffer(offerId: string) {
  if (!state.deniedOffers[offerId]) return;
  const next = { ...state.deniedOffers };
  delete next[offerId];
  set({ deniedOffers: next });
}

/** Refuse an incoming swap: locally hide it (the maker's escrow is untouched —
 *  only the maker can cancel it on-chain). Persisted so it stays hidden. */
export function denySwap(swapId: string) {
  if (state.deniedSwaps[swapId]) return;
  set({ deniedSwaps: { ...state.deniedSwaps, [swapId]: true } });
}
export function undenySwap(swapId: string) {
  if (!state.deniedSwaps[swapId]) return;
  const next = { ...state.deniedSwaps };
  delete next[swapId];
  set({ deniedSwaps: next });
}

export function resetStore() {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  state = empty();
  emit();
}
