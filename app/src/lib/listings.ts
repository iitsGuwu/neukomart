import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { PROGRAM_ID, collectionForAddress } from './constants';
import type { NeukoAsset, Listing } from './types';

/**
 * Reads live NEUKO listings straight from the chain via `getProgramAccounts`
 * (filtered to the `Listing` account discriminator) and decodes them — the same
 * authoritative pattern used for swaps.
 *
 * This replaces relying on the webhook/Redis indexer for listings: the indexer
 * can drift (a cancelled/sold listing whose close the webhook missed lingers as
 * a phantom, and a Listed event the webhook dropped never appears). Reading the
 * Listing PDAs directly means the grid always matches on-chain reality, so a
 * listing can never be shown that can't actually be bought or delisted.
 */

// Anchor account discriminator = sha256("account:Listing")[0..8].
const LISTING_DISC = Buffer.from([218, 32, 50, 73, 43, 134, 26, 58]);

/** Layout: disc(8) seller(32) asset(32) collection(32) price(u64) currency(u8) created_at(i64) bump(u8). */
function decodeListing(data: Buffer, assetMap: Map<string, NeukoAsset>): Listing | null {
  try {
    if (data.length < 122 || !data.subarray(0, 8).equals(LISTING_DISC)) return null;
    const seller = new PublicKey(data.subarray(8, 40)).toBase58();
    const assetId = new PublicKey(data.subarray(40, 72)).toBase58();
    const collectionAddr = new PublicKey(data.subarray(72, 104)).toBase58();
    const price = data.readBigUInt64LE(104);
    const currencyCode = data[112];
    const createdAt = data.readBigInt64LE(113);
    const currency = currencyCode === 1 ? 'gboy' : 'sol';

    const meta = collectionForAddress(collectionAddr);
    const asset: NeukoAsset =
      assetMap.get(assetId) ?? {
        id: assetId,
        name: `${assetId.slice(0, 4)}…${assetId.slice(-4)}`,
        collection: meta?.key ?? 'harmies',
        image: '',
        attributes: [],
      };

    return {
      id: 'listing-' + assetId,
      asset,
      seller,
      price: Number(price) / (currency === 'gboy' ? 1e10 : 1e9),
      currency,
      origin: 'neukomart',
      createdAt: Number(createdAt),
    };
  } catch {
    return null;
  }
}

/** All open NEUKO listings on-chain, most recent first. */
export async function fetchOnChainListings(
  connection: Connection,
  assetMap: Map<string, NeukoAsset>,
): Promise<Listing[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(LISTING_DISC) } }],
  });
  const out: Listing[] = [];
  for (const { account } of accounts) {
    const l = decodeListing(account.data as Buffer, assetMap);
    if (l) out.push(l);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
