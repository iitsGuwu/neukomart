import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { PROGRAM_ID } from './constants';
import type { NeukoAsset, SwapOffer } from './types';

/**
 * Reads live swap offers straight from the chain via `getProgramAccounts`
 * (filtered to the `SwapOffer` account discriminator) and decodes them. No
 * indexer needed: swaps are low-volume and ecosystem-locked, and reading them
 * directly means the maker can always see + cancel an escrowed swap, and takers
 * can browse + accept open ones.
 */

const SWAP_DISC = Buffer.from([7, 43, 1, 115, 121, 33, 172, 68]);
const SYSTEM = '11111111111111111111111111111111';

/** A decoded swap plus the on-chain nonce needed to rebuild its PDA. */
export interface OnChainSwap extends SwapOffer {
  nonce: string; // u64 as a decimal string
}

function readVecPubkeys(buf: Buffer, off: number): { keys: string[]; next: number } {
  const len = buf.readUInt32LE(off);
  off += 4;
  const keys: string[] = [];
  for (let i = 0; i < len; i++) {
    keys.push(new PublicKey(buf.subarray(off, off + 32)).toBase58());
    off += 32;
  }
  return { keys, next: off };
}

/** Resolve an asset id to its ecosystem metadata, with a safe minimal fallback. */
function toAsset(id: string, map: Map<string, NeukoAsset>): NeukoAsset {
  return (
    map.get(id) ?? {
      id,
      name: `${id.slice(0, 4)}…${id.slice(-4)}`,
      collection: 'harmies',
      image: '',
      attributes: [],
    }
  );
}

/** Decode a raw SwapOffer account. Returns null if it isn't one / is malformed. */
export function decodeSwap(
  pubkey: string,
  data: Buffer,
  assetMap: Map<string, NeukoAsset>,
): OnChainSwap | null {
  try {
    if (data.length < 8 || !data.subarray(0, 8).equals(SWAP_DISC)) return null;
    let off = 8;
    const maker = new PublicKey(data.subarray(off, off + 32)).toBase58();
    off += 32;
    const takerRaw = new PublicKey(data.subarray(off, off + 32)).toBase58();
    off += 32;
    const offered = readVecPubkeys(data, off);
    off = offered.next;
    const requested = readVecPubkeys(data, off);
    off = requested.next;
    const solOffered = data.readBigUInt64LE(off); off += 8;
    const gboyOffered = data.readBigUInt64LE(off); off += 8;
    const solRequested = data.readBigUInt64LE(off); off += 8;
    const gboyRequested = data.readBigUInt64LE(off); off += 8;
    const nonce = data.readBigUInt64LE(off); off += 8;
    const createdAt = data.readBigInt64LE(off); off += 8;

    return {
      id: pubkey,
      maker,
      taker: takerRaw === SYSTEM ? undefined : takerRaw, // default Pubkey = open to anyone
      give: {
        assets: offered.keys.map((k) => toAsset(k, assetMap)),
        sol: Number(solOffered) / 1e9,
        gboy: Number(gboyOffered) / 1e10,
      },
      want: {
        assets: requested.keys.map((k) => toAsset(k, assetMap)),
        sol: Number(solRequested) / 1e9,
        gboy: Number(gboyRequested) / 1e10,
      },
      createdAt: Number(createdAt),
      status: 'open',
      nonce: nonce.toString(),
    };
  } catch {
    return null;
  }
}

/** All open swap offers on-chain, most recent first. */
export async function fetchSwaps(
  connection: Connection,
  assetMap: Map<string, NeukoAsset>,
): Promise<OnChainSwap[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(SWAP_DISC) } }],
  });
  const out: OnChainSwap[] = [];
  for (const { pubkey, account } of accounts) {
    const s = decodeSwap(pubkey.toBase58(), account.data as Buffer, assetMap);
    if (s) out.push(s);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
