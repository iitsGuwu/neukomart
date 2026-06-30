import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Repeat2, ShieldCheck, Lock, Sparkles } from 'lucide-react';
import { AssetImage, EcoBadge, PriceTag } from '../components/ui';
import { COLLECTIONS, type CollectionKey } from '../lib/constants';
import { useMarketState } from '../lib/store';
import { useEcosystemAssets, useSwaps } from '../hooks/useWalletData';
import { compact } from '../lib/format';
import { traitValue } from '../lib/traits';
import type { Listing, NeukoAsset } from '../lib/types';

function floorFor(listings: Listing[], collection: CollectionKey, currency: 'sol' | 'gboy'): number {
  const xs = listings.filter((l) => l.asset.collection === collection && l.currency === currency);
  return xs.length ? Math.min(...xs.map((l) => l.price)) : 0;
}

function pickRandom(arr: NeukoAsset[], n: number): NeukoAsset[] {
  const c = [...arr];
  const out: NeukoAsset[] = [];
  for (let i = 0; i < n && c.length; i++) out.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]);
  return out;
}

export function Landing() {
  const market = useMarketState();
  const { assets } = useEcosystemAssets();
  // Read swaps straight from the chain (same source as Swap Studio) so the count
  // is accurate — the store's `swaps` is never seeded and would always show 0.
  const { data: swaps = [] } = useSwaps();
  const featured = market.listings.slice(0, 5);

  // Showcase: snake badge, moth badge, rabbit badge + 3 random Harmies (fresh each load).
  const cluster = useMemo(() => {
    const badges = assets.filter((a) => a.collection === 'badges');
    const harmies = assets.filter((a) => a.collection === 'harmies');
    const byEmblem = (e: string) => badges.filter((a) => traitValue(a, 'Emblem') === e);
    const [s1] = pickRandom(byEmblem('Snake').length ? byEmblem('Snake') : badges, 1);
    const [m1] = pickRandom(byEmblem('Moth').length ? byEmblem('Moth') : badges, 1);
    const [r1] = pickRandom(byEmblem('Rabbit').length ? byEmblem('Rabbit') : badges, 1);
    const six = [m1, s1, r1, ...pickRandom(harmies, 3)].filter(Boolean) as NeukoAsset[];
    return six.length === 6 ? six : assets.slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      {/* HERO */}
      <section className="relative pt-6 pb-12 sm:pt-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 chip border border-neon/25 bg-neon/10 text-neon mb-6"
            >
              <Sparkles size={13} /> The community marketplace
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="font-display text-4xl sm:text-6xl font-bold leading-[1.05] text-balance"
            >
              Trade the <span className="text-[#ff2222]">G*BOY</span> universe.
              <br /> Feeless. Swap-native.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="mt-5 text-lg text-slate-400 max-w-xl text-balance"
            >
              Buy, sell and barter Badges &amp; Harmies with SOL or $GBOY. One ecosystem, zero
              protocol fees, and the most flexible NFT swap engine on Solana.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className="mt-8 flex flex-wrap gap-3"
            >
              <Link to="/market" className="btn-primary !px-5 !py-3">
                Explore market <ArrowRight size={16} />
              </Link>
              <Link to="/swap" className="btn-ghost !px-5 !py-3">
                <Repeat2 size={16} /> Open Swap Studio
              </Link>
            </motion.div>
            <div className="mt-8 flex flex-wrap gap-2">
              <EcoBadge tone="gboy"><ShieldCheck size={12} className="mr-1" /> 0% fees</EcoBadge>
              <EcoBadge tone="neon"><Lock size={12} className="mr-1" /> Ecosystem-locked</EcoBadge>
              <EcoBadge tone="harm"><Repeat2 size={12} className="mr-1" /> Multi-asset barter</EcoBadge>
            </div>
          </div>

          {/* floating art cluster */}
          <div className="relative h-[420px] hidden lg:block">
            {cluster.map((a, i) => {
              const pos = [
                'top-0 left-10 rotate-[-6deg]',
                'top-10 right-0 rotate-[5deg]',
                'top-40 left-0 rotate-[3deg]',
                'bottom-0 left-28 rotate-[-3deg]',
                'bottom-8 right-10 rotate-[7deg]',
                'top-28 left-1/2 -translate-x-1/2 rotate-[-2deg]',
              ][i];
              return (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.15 + i * 0.08 }}
                  className={`absolute ${pos} w-36 panel overflow-hidden shadow-glow animate-floaty`}
                  style={{ animationDelay: `${i * 0.6}s` }}
                >
                  <div className="aspect-square">
                    <AssetImage asset={a} rounded="rounded-none" />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 py-6">
        {[
          { k: 'Collections', v: '2' },
          { k: 'Total supply', v: compact(COLLECTIONS.badges.supply + COLLECTIONS.harmies.supply) },
          { k: 'All live listings', v: String(market.listings.length) },
          { k: 'Open swaps', v: String(swaps.filter((s) => s.status === 'open').length) },
        ].map((s) => (
          <div key={s.k} className="panel px-5 py-4">
            <div className="font-display text-3xl font-bold">{s.v}</div>
            <div className="label mt-1">{s.k}</div>
          </div>
        ))}
      </section>

      {/* COLLECTIONS */}
      <section className="py-10">
        <div className="grid md:grid-cols-2 gap-5">
          {Object.values(COLLECTIONS).map((c) => (
            <Link
              key={c.key}
              to={`/market?collection=${c.key}`}
              className="group relative panel overflow-hidden card-hover"
            >
              <div className="flex gap-5 p-5">
                <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-[color:var(--border)]">
                  <img
                    src={c.cover}
                    alt={c.name}
                    className="h-full w-full object-cover"
                    onError={(e) => (e.currentTarget.style.opacity = '0.2')}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-xl font-bold">{c.name}</h3>
                    <span className="chip bg-[var(--soft)] text-slate-400 text-[10px]">{c.symbol}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-slate-400 line-clamp-2">{c.blurb}</p>
                  <div className="mt-3 flex items-center gap-4 text-sm">
                    <span className="text-slate-500">Supply <b className="text-slate-200">{c.supply}</b></span>
                    <span className="text-slate-500">
                      Floor{' '}
                      <PriceTag amount={floorFor(market.listings, c.key, 'sol')} currency="sol" size="sm" className="!inline-flex" />
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* WHY */}
      <section className="py-10">
        <div className="grid md:grid-cols-3 gap-4">
          {[
            {
              icon: ShieldCheck,
              t: 'Truly feeless',
              d: 'The protocol takes nothing. Sellers keep 100% of every sale — you only ever pay Solana network gas.',
              tone: 'text-gboy',
            },
            {
              icon: Repeat2,
              t: 'Barter engine',
              d: 'Swap NFT-for-NFT, bundle many for one, or sweeten any deal with SOL or $GBOY on either side. Atomic settlement.',
              tone: 'text-harm',
            },
            {
              icon: Lock,
              t: 'Ecosystem-locked',
              d: 'Only Badges, Harmies and $GBOY can ever touch this market. No spoofed collections, no foreign tokens.',
              tone: 'text-neon',
            },
          ].map((f) => (
            <div key={f.t} className="panel p-6">
              <f.icon className={f.tone} size={26} />
              <h3 className="mt-4 font-display text-lg font-bold">{f.t}</h3>
              <p className="mt-2 text-sm text-slate-400">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURED */}
      {featured.length > 0 && (
        <section className="py-10">
          <div className="flex items-end justify-between mb-5">
            <h2 className="font-display text-2xl font-bold">Fresh listings</h2>
            <Link to="/market" className="text-sm text-neon hover:underline flex items-center gap-1">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {featured.map((l) => (
              <Link key={l.id} to={`/asset/${l.asset.id}`} className="group panel overflow-hidden card-hover">
                <div className="aspect-square overflow-hidden">
                  <AssetImage asset={l.asset} rounded="rounded-none" className="group-hover:scale-105 transition-transform" />
                </div>
                <div className="p-3">
                  <div className="text-sm font-semibold truncate">{l.asset.name}</div>
                  <div className="mt-1.5">
                    <PriceTag amount={l.price} currency={l.currency} size="sm" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
