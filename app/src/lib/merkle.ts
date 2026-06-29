import { sha256 } from '@noble/hashes/sha256';
import { PublicKey } from '@solana/web3.js';
import type { NeukoAsset } from './types';

/**
 * Merkle trees for swap "trait-group" requests, matching the program's
 * on-chain verifier EXACTLY (see `merkle_member` in lib.rs):
 *   • leaf      = sha256(asset_pubkey_bytes)
 *   • internal  = sha256(min(a,b) || max(a,b))   (sorted pairs, no direction bits)
 *   • odd node  promoted to the next level
 * Leaves are sorted by their bytes so the maker and taker, building from the
 * same pubkey set (e.g. every "Snake" badge), always get an identical root.
 */

function cmp(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [x, y] = cmp(a, b) <= 0 ? [a, b] : [b, a];
  const buf = new Uint8Array(64);
  buf.set(x, 0);
  buf.set(y, 32);
  return sha256(buf);
}

export function leafOf(pubkey: string): Uint8Array {
  return sha256(new PublicKey(pubkey).toBytes());
}

/** Sorted leaf layer + all internal layers (bottom-up). */
function buildLayers(pubkeys: string[]): Uint8Array[][] {
  const leaves = pubkeys.map(leafOf).sort(cmp);
  const layers: Uint8Array[][] = [leaves];
  let layer = leaves;
  while (layer.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(i + 1 < layer.length ? hashPair(layer[i], layer[i + 1]) : layer[i]); // promote odd
    }
    layers.push(next);
    layer = next;
  }
  return layers;
}

/** 32-byte Merkle root over a set of asset pubkeys (empty set → 32 zero bytes). */
export function merkleRoot(pubkeys: string[]): Uint8Array {
  if (pubkeys.length === 0) return new Uint8Array(32);
  const layers = buildLayers(pubkeys);
  return layers[layers.length - 1][0];
}

/** Proof that `target` is a member of the set — siblings bottom-up. */
export function merkleProof(pubkeys: string[], target: string): Uint8Array[] {
  const layers = buildLayers(pubkeys);
  const targetLeaf = leafOf(target);
  let idx = layers[0].findIndex((l) => cmp(l, targetLeaf) === 0);
  if (idx < 0) return [];
  const proof: Uint8Array[] = [];
  for (let level = 0; level < layers.length - 1; level++) {
    const layer = layers[level];
    const siblingIdx = idx % 2 === 1 ? idx - 1 : idx + 1;
    if (siblingIdx < layer.length) proof.push(layer[siblingIdx]); // (promoted node has none)
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Badge trait groups ──────────────────────────────────────────────────────

export function emblemOf(a: NeukoAsset): string | undefined {
  return a.attributes.find((at) => at.trait_type === 'Emblem')?.value;
}

/** emblem → sorted list of every badge pubkey of that emblem in the ecosystem. */
export function badgePubkeysByEmblem(ecosystem: NeukoAsset[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const a of ecosystem) {
    if (a.collection !== 'badges') continue;
    const e = emblemOf(a);
    if (!e) continue;
    if (!m.has(e)) m.set(e, []);
    m.get(e)!.push(a.id);
  }
  // canonical order (root is order-independent, but keep deterministic)
  for (const list of m.values()) list.sort();
  return m;
}

/** rootHex → emblem, so a decoded swap root maps back to a readable type. */
export function emblemRootIndex(ecosystem: NeukoAsset[]): Map<string, string> {
  const byEmblem = badgePubkeysByEmblem(ecosystem);
  const index = new Map<string, string>();
  for (const [emblem, pubkeys] of byEmblem) index.set(toHex(merkleRoot(pubkeys)), emblem);
  return index;
}
