import { VersionedTransaction, type Connection, type PublicKey } from '@solana/web3.js';
import type { Listing } from './types';

/**
 * Client-side helpers for executing native Magic Eden and Tensor purchases
 * without leaving the NEUKO marketplace.
 *
 * Flow for both:
 *   1. POST to our server-side proxy (which holds the API key)
 *   2. Proxy fetches a pre-built, partially-signed serialized tx from ME/Tensor
 *   3. We deserialize it → VersionedTransaction
 *   4. Caller passes it to wallet.signAndSendTransaction()
 *
 * If the API key isn't configured, the proxy returns { error: 'not configured' }
 * and we throw ExternalBuyNotConfigured so the caller can redirect instead.
 */

export class ExternalBuyNotConfigured extends Error {
  constructor(public readonly platform: 'magiceden' | 'tensor') {
    super(`${platform} buy not configured — redirect instead`);
    this.name = 'ExternalBuyNotConfigured';
  }
}

export class ExternalBuyFailed extends Error {
  constructor(public readonly platform: 'magiceden' | 'tensor', message: string) {
    super(message);
    this.name = 'ExternalBuyFailed';
  }
}

// ---- Fee constants ----------------------------------------------------------

/** Platform fees as a fraction of sale price. Buyer pays listed price; fee
 *  comes out of the seller's proceeds. */
export const PLATFORM_FEE: Record<'magiceden' | 'tensor' | 'neukomart', number> = {
  neukomart: 0,
  magiceden: 0.02,    // 2%
  tensor:    0.015,   // 1.5% (TSWAP standard; TCOMP may differ)
};

/**
 * Human-readable fee label for a platform.
 * e.g.  feeLabel('magiceden', 1.5) → "0.030 SOL (2% ME fee)"
 */
export function feeLabel(
  platform: 'magiceden' | 'tensor' | 'neukomart',
  price: number,
): { feeAmount: number; feePct: number; sellerReceives: number } {
  const feePct = PLATFORM_FEE[platform];
  const feeAmount = price * feePct;
  const sellerReceives = price - feeAmount;
  return { feeAmount, feePct, sellerReceives };
}

// ---- Magic Eden -------------------------------------------------------------

/**
 * Fetch and deserialize a Magic Eden buy_now transaction.
 * Throws ExternalBuyNotConfigured if ME_API_KEY isn't set in Vercel env.
 */
export async function buildMeBuyTx(
  buyer: PublicKey,
  listing: Listing,
  _connection: Connection, // reserved for future pre-flight sim
): Promise<VersionedTransaction> {
  const qs = new URLSearchParams({
    buyer: buyer.toBase58(),
    seller: listing.seller,
    mint: listing.asset.id,
    price: listing.price.toString(),
  });

  const res = await fetch(`/api/me-buy?${qs}`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new ExternalBuyFailed('magiceden', `Proxy error ${res.status}`);
  }

  const json = await res.json() as {
    error?: string;
    tx?: { type: string; data: number[] } | { type: 'Buffer'; data: number[] };
  };

  if (json.error === 'not configured') throw new ExternalBuyNotConfigured('magiceden');
  if (json.error) throw new ExternalBuyFailed('magiceden', json.error);
  if (!json.tx) throw new ExternalBuyFailed('magiceden', 'No transaction returned');

  // ME returns a Buffer-serialized legacy or versioned transaction.
  const txBytes = new Uint8Array(json.tx.data);
  return deserializeTx(txBytes, 'magiceden');
}

// ---- Tensor -----------------------------------------------------------------

/**
 * Fetch and deserialize a Tensor buy transaction (TSWAP).
 * Throws ExternalBuyNotConfigured if TENSOR_API_KEY isn't set.
 */
export async function buildTensorBuyTx(
  buyer: PublicKey,
  listing: Listing,
  _connection: Connection,
): Promise<VersionedTransaction> {
  // Tensor price is in lamports (integer).
  const priceLamports = Math.round(listing.price * 1e9).toString();

  const qs = new URLSearchParams({
    buyer: buyer.toBase58(),
    owner: listing.seller,
    mint: listing.asset.id,
    price: priceLamports,
  });

  const res = await fetch(`/api/tensor-buy?${qs}`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new ExternalBuyFailed('tensor', `Proxy error ${res.status}`);
  }

  const json = await res.json() as {
    error?: string;
    txV0?: { data: number[] };
  };

  if (json.error === 'not configured') throw new ExternalBuyNotConfigured('tensor');
  if (json.error) throw new ExternalBuyFailed('tensor', json.error);
  if (!json.txV0) throw new ExternalBuyFailed('tensor', 'No transaction returned');

  const txBytes = new Uint8Array(json.txV0.data);
  return deserializeTx(txBytes, 'tensor');
}

// ---- Shared -----------------------------------------------------------------

function deserializeTx(
  bytes: Uint8Array,
  platform: 'magiceden' | 'tensor',
): VersionedTransaction {
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch (e) {
    throw new ExternalBuyFailed(platform, `Failed to deserialize transaction: ${e}`);
  }
}
