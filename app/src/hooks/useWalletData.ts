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
} from '../lib/chain';
import { demoInventory, seedMarket, seedFromIndexer, seedFromLive, isSeeded, useMarketState } from '../lib/store';
import { loadIndexedMarket } from '../lib/indexer';
import { loadLiveMarket } from '../lib/live-market';
import { ALL_ASSETS } from '../lib/seed';
import type { NeukoAsset } from '../lib/types';
import { DEMO_MODE } from '../lib/constants';

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

/** Seeds the market exactly once, app-wide. Prefers the live on-chain indexer
 *  (`/api/market`) when configured; otherwise seeds the demo set from real
 *  assets. Waits for the ecosystem query to settle to avoid the placeholder. */
export function useSeedMarket() {
  const { assets, isLoading } = useEcosystemAssets();
  useEffect(() => {
    if (isLoading || assets.length === 0 || isSeeded()) return;
    let cancelled = false;
    (async () => {
      const assetMap = new Map(assets.map((a) => [a.id, a]));
      // 1) On-chain NEUKO indexer (once the program is deployed + configured).
      const idx = await loadIndexedMarket(assetMap);
      if (cancelled || isSeeded()) return;
      if (idx) {
        seedFromIndexer(idx, assets);
        return;
      }
      // 2) Live Magic Eden listings/sales (real prices today, pre-deploy).
      const live = await loadLiveMarket(assetMap);
      if (cancelled || isSeeded()) return;
      if (live) seedFromLive(live, assets);
      // 3) Bundled demo set (offline / ME unreachable).
      else seedMarket(assets);
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoading, assets]);
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
 * supports it; otherwise falls back to a deterministic demo inventory so the
 * portfolio / list / swap flows are reviewable.
 */
export function useMyAssets() {
  const { publicKey } = useWallet();
  const key = publicKey?.toBase58();
  const market = useMarketState();

  const query = useQuery({
    queryKey: ['my-assets', key],
    enabled: !!publicKey,
    queryFn: async (): Promise<{ assets: NeukoAsset[]; live: boolean }> => {
      try {
        // DAS succeeded → trust it, even if the wallet holds nothing.
        const live = await dasAssetsByOwner(key!);
        return { assets: live, live: true };
      } catch {
        // DAS unsupported on this RPC — fall back to a demo inventory.
        if (DEMO_MODE) return { assets: demoInventory(key!), live: false };
        return { assets: [], live: false };
      }
    },
  });

  // Apply local demo ownership transfers (buys / swaps) on top.
  const base = query.data?.assets ?? [];
  const owned = base.filter((a) => {
    const o = market.ownership[a.id];
    return !o || o === key;
  });
  const gained = Object.entries(market.ownership)
    .filter(([, owner]) => owner === key)
    .map(([id]) => [...market.listings.map((l) => l.asset), ...allAssetsFlat(market)].find((a) => a.id === id))
    .filter((a): a is NeukoAsset => !!a && !owned.some((o) => o.id === a.id));

  return {
    ...query,
    assets: [...owned, ...gained],
    live: query.data?.live ?? false,
  };
}

function allAssetsFlat(market: ReturnType<typeof useMarketState>): NeukoAsset[] {
  const set = new Map<string, NeukoAsset>();
  market.listings.forEach((l) => set.set(l.asset.id, l.asset));
  market.swaps.forEach((s) => {
    s.give.assets.forEach((a) => set.set(a.id, a));
    s.want.assets.forEach((a) => set.set(a.id, a));
  });
  return [...set.values()];
}
