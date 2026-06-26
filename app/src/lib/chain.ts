import { Connection, PublicKey } from '@solana/web3.js';
import {
  RPC_URL,
  GBOY_MINT,
  GBOY_DECIMALS,
  PROGRAM_ID,
  BADGES_COLLECTION,
  HARMIES_COLLECTION,
  collectionForAddress,
} from './constants';
import type { NeukoAsset, Attribute } from './types';

let _conn: Connection | null = null;
export function getConnection(): Connection {
  if (!_conn) _conn = new Connection(RPC_URL, 'confirmed');
  return _conn;
}

export async function getSolBalance(owner: PublicKey): Promise<number> {
  const lamports = await getConnection().getBalance(owner, 'confirmed');
  return lamports / 1e9;
}

export async function getGboyBalance(owner: PublicKey): Promise<number> {
  try {
    const res = await getConnection().getParsedTokenAccountsByOwner(owner, {
      mint: GBOY_MINT,
    });
    let total = 0;
    for (const { account } of res.value) {
      const amt = account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0;
      total += amt;
    }
    return total;
  } catch {
    return 0;
  }
}

/** Is the marketplace program deployed at the expected address? */
export async function isProgramDeployed(): Promise<boolean> {
  try {
    const info = await getConnection().getAccountInfo(PROGRAM_ID);
    return !!info?.executable;
  } catch {
    return false;
  }
}

// ----------------------- DAS (Digital Asset Standard) -----------------------
// Works against DAS-enabled RPCs (e.g. Helius). On a plain RPC these calls
// reject and the app falls back to bundled seed data.

interface DasAsset {
  id: string;
  ownership?: { owner?: string };
  grouping?: { group_key: string; group_value: string }[];
  content?: {
    metadata?: { name?: string; attributes?: Attribute[] };
    links?: { image?: string };
    files?: { uri?: string; cdn_uri?: string }[];
  };
}

async function dasCall<T>(method: string, params: unknown): Promise<T> {
  // Retry transient failures (rate limits / 5xx / network blips). Without this a
  // single hiccup on the large getAssetsByGroup calls drops the whole ecosystem
  // load back to the bundled fallback set — which then can't be listed/bought
  // on-chain (fake ids) and won't join live Magic Eden listings.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'neuko', method, params }),
      });
    } catch (e) {
      lastErr = e; // network error — retry
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`DAS HTTP ${res.status}`);
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 200));
      continue;
    }
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'DAS error'); // non-transient
    return json.result as T;
  }
  throw lastErr ?? new Error('DAS unreachable');
}

function normalize(a: DasAsset): NeukoAsset | null {
  const group = a.grouping?.find((g) => g.group_key === 'collection');
  const meta = collectionForAddress(group?.group_value);
  if (!meta) return null; // outside the ecosystem — ignored by design
  const image =
    a.content?.links?.image ||
    a.content?.files?.[0]?.cdn_uri ||
    a.content?.files?.[0]?.uri ||
    '';
  const name = a.content?.metadata?.name || meta.name;
  const num = Number(name.split('#')[1]) || undefined;
  return {
    id: a.id,
    name,
    collection: meta.key,
    image,
    number: num,
    owner: a.ownership?.owner,
    attributes: a.content?.metadata?.attributes ?? [],
    generative: false,
  };
}

/** Live holdings for a wallet, restricted to the two ecosystem collections. */
export async function dasAssetsByOwner(owner: string): Promise<NeukoAsset[]> {
  const result = await dasCall<{ items: DasAsset[] }>('getAssetsByOwner', {
    ownerAddress: owner,
    page: 1,
    limit: 1000,
  });
  return (result.items || [])
    .map(normalize)
    .filter((x): x is NeukoAsset => x !== null);
}

/** All assets in one ecosystem collection (single page). */
export async function dasAssetsByCollection(
  collection: PublicKey,
  page = 1,
  limit = 1000,
): Promise<NeukoAsset[]> {
  const result = await dasCall<{ items: DasAsset[] }>('getAssetsByGroup', {
    groupKey: 'collection',
    groupValue: collection.toBase58(),
    page,
    limit,
  });
  return (result.items || [])
    .map(normalize)
    .filter((x): x is NeukoAsset => x !== null);
}

/** Every asset in a collection, following DAS pagination (capped for safety). */
export async function dasCollectionAll(
  collection: PublicKey,
  maxPages = 6,
): Promise<NeukoAsset[]> {
  const all: NeukoAsset[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await dasAssetsByCollection(collection, page, 1000);
    all.push(...batch);
    if (batch.length < 1000) break; // last page
  }
  return all;
}

/** A capped sample across both collections — enough to power pickers/search. */
export async function dasAllEcosystemAssets(perCollection = 250): Promise<NeukoAsset[]> {
  const [badges, harmies] = await Promise.all([
    dasAssetsByCollection(BADGES_COLLECTION, 1, perCollection),
    dasAssetsByCollection(HARMIES_COLLECTION, 1, perCollection),
  ]);
  return [...badges, ...harmies];
}

/** The full ecosystem (both collections, all pages) for browsing & filtering. */
export async function dasEcosystemFull(): Promise<NeukoAsset[]> {
  const [badges, harmies] = await Promise.all([
    dasCollectionAll(BADGES_COLLECTION),
    dasCollectionAll(HARMIES_COLLECTION),
  ]);
  return [...badges, ...harmies];
}

export const GBOY_UI_DECIMALS = GBOY_DECIMALS;
