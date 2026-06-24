import { PublicKey } from '@solana/web3.js';

/**
 * The NEUKO / G*BOY ecosystem registry.
 *
 * These are the ONLY assets this marketplace will ever interact with. Both the
 * UI and the on-chain program enforce this allow-list — anything outside it is
 * rejected by design.
 *
 * Verified on Solana mainnet-beta:
 *   - Badges  : Metaplex Core Collection "G*BOY Badges" (1,500 minted)
 *   - Harmies : Metaplex Core Collection "Harmies"      (500 minted)
 *   - $GBOY   : SPL Token, 10 decimals
 */
export const BADGES_COLLECTION = new PublicKey(
  'EEahNmYDk2KW8GJ34cnS6KqBS3B4QdezCCSenUQGpPL8',
);
export const HARMIES_COLLECTION = new PublicKey(
  '5yKCYuZCcJU3aXwppGK87Gi59T6ceNKrTzyXYvJfsp3q',
);
export const GBOY_MINT = new PublicKey(
  'svy5ErijNYy9hEVzxknCdwWdZ3NeXJTdpb9Ndnso17f',
);

export const BADGES_CREATOR = new PublicKey(
  'DQ1LJZ2ET1oHcCgojCN3kXakTQSkuCxgEqXguf2UrYS5',
);
export const HARMIES_CREATOR = new PublicKey(
  '57MFtfGrJheHeRzeSpARcUEBqa9jXELGGZrRszysf4VB',
);

/** Deployed marketplace program (Anchor). */
export const PROGRAM_ID = new PublicKey(
  'Foz4ZtLQKKdSk4V1d6cDp6Gr3gActoQGUhh5B4YTafA2',
);

/** MPL Core program. */
export const MPL_CORE_PROGRAM_ID = new PublicKey(
  'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d',
);

export const GBOY_DECIMALS = 10;
export const GBOY_SYMBOL = '$GBOY';
export const SOL_DECIMALS = 9;

export type CollectionKey = 'badges' | 'harmies';

export interface CollectionMeta {
  key: CollectionKey;
  name: string;
  symbol: string;
  address: PublicKey;
  creator: PublicKey;
  supply: number;
  blurb: string;
  /** Real on-chain cover art. */
  cover: string;
  accent: string; // tailwind color token name for theming
}

export const COLLECTIONS: Record<CollectionKey, CollectionMeta> = {
  badges: {
    key: 'badges',
    name: 'G*BOY Badges',
    symbol: 'GBB',
    address: BADGES_COLLECTION,
    creator: BADGES_CREATOR,
    supply: 1500,
    blurb: 'On-chain merit. 1,500 retro badges earned across the G*BOY arcade.',
    cover:
      'https://gateway.pinit.io/ipfs/QmXEKCYeKybynxgEpYxqYpPkVrxyoi41KuozoguAwHSLUL/0',
    accent: 'neon',
  },
  harmies: {
    key: 'harmies',
    name: 'Harmies',
    symbol: 'HARM',
    address: HARMIES_COLLECTION,
    creator: HARMIES_CREATOR,
    supply: 500,
    blurb:
      'They burned them, buried them and bolted them back together. 500 reasons to smile.',
    cover:
      'https://gray-patient-duck-402.mypinata.cloud/ipfs/bafybeibg4fqx7o64phhlig5che54xhcnrkwtry3me4j4a3by4kxz4xvorq',
    accent: 'harm',
  },
};

export const COLLECTION_BY_ADDRESS: Record<string, CollectionMeta> = {
  [BADGES_COLLECTION.toBase58()]: COLLECTIONS.badges,
  [HARMIES_COLLECTION.toBase58()]: COLLECTIONS.harmies,
};

export function collectionForAddress(addr?: string): CollectionMeta | undefined {
  if (!addr) return undefined;
  return COLLECTION_BY_ADDRESS[addr];
}

/** RPC endpoint. Override with VITE_RPC_URL (a DAS-enabled endpoint unlocks
 *  fully live indexing of holdings & listings). */
export const RPC_URL: string =
  import.meta.env.VITE_RPC_URL || 'https://api.mainnet-beta.solana.com';

export const NETWORK_LABEL: string =
  import.meta.env.VITE_NETWORK || 'mainnet-beta';

/** When true, the app augments live data with bundled seed listings/offers so
 *  the marketplace is fully populated for review without a DAS key. Defaults to
 *  OFF — the app is driven by live data (on-chain indexer > Magic Eden). Set
 *  VITE_DEMO=true only to repopulate the demo layer for local review. */
export const DEMO_MODE: boolean =
  (import.meta.env.VITE_DEMO ?? 'false') !== 'false';
