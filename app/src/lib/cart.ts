import { useSyncExternalStore } from 'react';
import type { Listing } from './types';

/** Floor-sweep cart — a set of listings to buy together in one transaction. */

/** Hard cap to prevent unbounded sweep state and excessive RPC calls. */
const MAX_CART_SIZE = 20;
let items: Listing[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function useCart(): Listing[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
    () => items,
  );
}

export function cartHas(id: string): boolean {
  return items.some((l) => l.id === id);
}

export function cartToggle(listing: Listing): boolean {
  if (cartHas(listing.id)) {
    items = items.filter((l) => l.id !== listing.id);
    emit();
    return true;
  }
  if (items.length >= MAX_CART_SIZE) {
    // Caller should show a warning — return false to signal rejection.
    return false;
  }
  items = [...items, listing];
  emit();
  return true;
}

export function cartRemove(id: string) {
  items = items.filter((l) => l.id !== id);
  emit();
}

export function cartClear() {
  items = [];
  emit();
}

export function cartTotals(): { sol: number; gboy: number; count: number } {
  return items.reduce(
    (acc, l) => {
      if (l.currency === 'sol') acc.sol += l.price;
      else acc.gboy += l.price;
      acc.count += 1;
      return acc;
    },
    { sol: 0, gboy: 0, count: 0 },
  );
}
