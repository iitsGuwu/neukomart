import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import {
  getSolBalance,
  getGboyBalance,
  isProgramDeployed,
  dasAssetsByOwner,
  dasEcosystemFull,
  getConnection,
} from '../lib/chain';
import { seedAll, isSeeded } from '../lib/store';
import { loadIndexedMarket } from '../lib/indexer';
import { loadLiveMarket } from '../lib/live-market';
import { fetchSwaps } from '../lib/swaps';
import { ALL_ASSETS } from '../lib/seed';
import type { NeukoAsset, Listing } from '../lib/types';

/**
 * Every ecosystem asset (both collections, fully paginated) for browsing,
 * filtering and pickers. Live via DAS when available; otherwise the bundled
 * fallback set.
 */
export function useEcosystemAssets() {
  const query = useQuery({
    queryKey: ['ecosystem-assets-full'],
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async (): Promise<{ assets: NeukoAsset[]; live: boolean }> => {
      try {
        const live = await dasEcosystemFull();
        if (live.length > 0) return { assets: live, live: true };
      } catch {
        /* DAS unsupported */
      }
      return { assets: ALL_ASSETS, live: false };
    },
  });
  return {
    assets: query.data?.assets ?? ALL_ASSETS,
    live: query.data?.live ?? false,
    isLoading: query.isLoading,
  };
}

/** Seeds the market exactly once, app-wide, from ALL live sources merged:
 *  the NEUKO on-chain indexer (`/api/market`) plus Magic Eden / Tensor
 *  aggregation. NEUKO-native listings take priority per asset (0% fee, native
 *  settlement). Waits for the ecosystem query to settle to avoid placeholders. */
export function useSeedMarket() {
  const { assets, isLoading } = useEcosystemAssets();
  useEffect(() => {
    if (isLoading || assets.length === 0 || isSeeded()) return;
    let cancelled = false;
    (async () => {
      const assetMap = new Map(assets.map((a) => [a.id, a]));
      // Load both sources in parallel — neither blocks the other.
      const [idx, live] = await Promise.all([
        loadIndexedMarket(assetMap),
        loadLiveMarket(assetMap),
      ]);
      if (cancelled || isSeeded()) return;

      // Merge listings keyed by asset: seed ME/Tensor first, then overlay
      // NEUKO listings so a native listing wins over an external one.
      const byAsset = new Map<string, Listing>();
      for (const l of live?.listings ?? []) byAsset.set(l.asset.id, l);
      for (const l of idx?.listings ?? []) byAsset.set(l.asset.id, l);

      const activity = [...(idx?.activity ?? []), ...(live?.activity ?? [])]
        .sort((a, b) => b.time - a.time)
        .slice(0, 200);

      seedAll({
        listings: [...byAsset.values()],
        offers: idx?.offers ?? [], // offers are NEUKO-native only
        activity,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoading, assets]);
}

/** Live swap offers read straight from the chain (getProgramAccounts). Polls so
 *  newly created / accepted / cancelled swaps appear without a reload. */
export function useSwaps() {
  const { assets } = useEcosystemAssets();
  return useQuery({
    queryKey: ['swaps'],
    enabled: assets.length > 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const assetMap = new Map(assets.map((a) => [a.id, a]));
      try {
        return await fetchSwaps(getConnection(), assetMap);
      } catch {
        return [];
      }
    },
  });
}

export function useBalances() {
  const { publicKey } = useWallet();
  const key = publicKey?.toBase58();
  return useQuery({
    queryKey: ['balances', key],
    enabled: !!publicKey,
    refetchInterval: 30_000,
    queryFn: async () => {
      const pk = new PublicKey(key!);
      const [sol, gboy] = await Promise.all([getSolBalance(pk), getGboyBalance(pk)]);
      return { sol, gboy };
    },
  });
}

export function useProgramStatus() {
  return useQuery({
    queryKey: ['program-deployed'],
    staleTime: 5 * 60_000,
    queryFn: isProgramDeployed,
  });
}

/**
 * The connected wallet's ecosystem holdings. Uses live DAS data when the RPC
 * supports it; otherwise falls back to a empty inventory.
 */
export function useMyAssets() {
  const { publicKey } = useWallet();
  const key = publicKey?.toBase58();

  const query = useQuery({
    queryKey: ['my-assets', key],
    enabled: !!publicKey,
    queryFn: async (): Promise<{ assets: NeukoAsset[]; live: boolean }> => {
      try {
        // DAS succeeded → trust it, even if the wallet holds nothing.
        const live = await dasAssetsByOwner(key!);
        return { assets: live, live: true };
      } catch {
        // DAS unsupported on this RPC — return empty
        return { assets: [], live: false };
      }
    },
  });

  return {
    ...query,
    assets: query.data?.assets ?? [],
    live: query.data?.live ?? false,
  };
}
