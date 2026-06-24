import type { Currency } from './types';

export function shortAddress(addr?: string, chars = 4): string {
  if (!addr) return '—';
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}

export function formatAmount(n: number, currency: Currency): string {
  const max = currency === 'sol' ? 4 : 2;
  const s = n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: max,
  });
  return s;
}

export function currencyLabel(currency: Currency): string {
  return currency === 'sol' ? 'SOL' : '$GBOY';
}

export function compact(n: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function timeAgo(unixSeconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** A deterministic pseudo-random generator seeded from a string. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const t = (h ^= h >>> 16) >>> 0;
    return t / 4294967296;
  };
}
