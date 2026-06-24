import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, X, Check, Gavel, Square, LayoutGrid, Grid3x3, Info } from 'lucide-react';
import clsx from 'clsx';
import { MarketCard } from '../components/NFTCard';
import { BuyDialog, MakeOfferDialog } from '../components/dialogs';
import { SectionTitle, CurrencyIcon } from '../components/ui';
import { useMarketState } from '../lib/store';
import { useEcosystemAssets } from '../hooks/useWalletData';
import { COLLECTIONS, type CollectionKey } from '../lib/constants';
import { TRAIT_CONFIG, collectTraitValues, traitValue, swatchFor } from '../lib/traits';
import { ORIGIN_META } from '../components/ui';
import type { Listing, Currency, NeukoAsset, MarketOrigin } from '../lib/types';

type Sort = 'recent' | 'price-asc' | 'price-desc' | 'number';
type CollFilter = 'all' | CollectionKey;
type StatusFilter = 'all' | 'listed' | 'unlisted';
type CurFilter = 'all' | Currency;
type SourceFilter = 'all' | MarketOrigin;
type View = 'single' | 'grid3' | 'grid5';
const PAGE = 48;

const VIEW_GRID: Record<View, string> = {
  single: 'grid-cols-1 max-w-md mx-auto',
  grid3: 'grid-cols-2 sm:grid-cols-3',
  grid5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5',
};

export function Marketplace() {
  const { assets, isLoading } = useEcosystemAssets();
  const market = useMarketState();
  const [params, setParams] = useSearchParams();

  const [coll, setColl] = useState<CollFilter>((params.get('collection') as CollFilter) || 'all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [cur, setCur] = useState<CurFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [traits, setTraits] = useState<Record<string, Set<string>>>({});
  const [sort, setSort] = useState<Sort>('recent');
  const [q, setQ] = useState('');
  const [visible, setVisible] = useState(PAGE);
  const [showFilters, setShowFilters] = useState(false);
  const [buying, setBuying] = useState<Listing | null>(null);
  const [floorBid, setFloorBid] = useState(false);
  const [view, setView] = useState<View>('grid3');

  const isPreview = market.listings.length > 0 && market.listings.some((l) => l.demo);

  const listingByAsset = useMemo(
    () => new Map(market.listings.map((l) => [l.asset.id, l])),
    [market.listings],
  );

  const traitValues = useMemo(
    () => (coll === 'all' ? null : collectTraitValues(assets, coll)),
    [assets, coll],
  );

  const traitKey = JSON.stringify(
    Object.fromEntries(Object.entries(traits).map(([k, v]) => [k, [...v]])),
  );

  useEffect(() => {
    setVisible(PAGE);
  }, [coll, status, source, cur, priceMin, priceMax, traitKey, q, sort]);

  const filtered = useMemo(() => {
    let xs = assets;
    if (coll !== 'all') xs = xs.filter((a) => a.collection === coll);
    if (q.trim()) {
      const needle = q.toLowerCase();
      xs = xs.filter((a) => a.name.toLowerCase().includes(needle));
    }
    for (const [k, vals] of Object.entries(traits)) {
      if (vals.size) xs = xs.filter((a) => vals.has(traitValue(a, k) ?? '∅'));
    }
    if (status === 'listed') xs = xs.filter((a) => listingByAsset.has(a.id));
    else if (status === 'unlisted') xs = xs.filter((a) => !listingByAsset.has(a.id));
    // Source filter: only show assets that have a listing matching the origin.
    // (Unlisted assets have no origin, so they're excluded when source != 'all'.)
    if (source !== 'all') {
      xs = xs.filter((a) => listingByAsset.get(a.id)?.origin === source);
    }
    if (cur !== 'all') xs = xs.filter((a) => listingByAsset.get(a.id)?.currency === cur);
    const min = parseFloat(priceMin);
    const max = parseFloat(priceMax);
    if (!isNaN(min)) xs = xs.filter((a) => (listingByAsset.get(a.id)?.price ?? -1) >= min);
    if (!isNaN(max)) xs = xs.filter((a) => { const l = listingByAsset.get(a.id); return l != null && l.price <= max; });

    const arr = [...xs];
    arr.sort((a, b) => {
      const la = listingByAsset.get(a.id);
      const lb = listingByAsset.get(b.id);
      if (sort === 'price-asc' || sort === 'price-desc') {
        if (la && lb) return sort === 'price-asc' ? la.price - lb.price : lb.price - la.price;
        if (la) return -1;
        if (lb) return 1;
        return (a.number ?? 0) - (b.number ?? 0);
      }
      if (sort === 'number') return (a.number ?? 0) - (b.number ?? 0);
      if (la && lb) return lb.createdAt - la.createdAt;
      if (la) return -1;
      if (lb) return 1;
      return (a.number ?? 0) - (b.number ?? 0);
    });
    return arr;
  }, [assets, coll, q, traits, status, cur, priceMin, priceMax, sort, listingByAsset]);

  const setCollection = (c: CollFilter) => {
    setColl(c);
    setTraits({});
    if (c === 'all') params.delete('collection');
    else params.set('collection', c);
    setParams(params, { replace: true });
  };

  const toggleTrait = (key: string, value: string) =>
    setTraits((prev) => {
      const next = { ...prev };
      const set = new Set(next[key] ?? []);
      set.has(value) ? set.delete(value) : set.add(value);
      next[key] = set;
      return next;
    });

  const activeFilters =
    Object.values(traits).reduce((n, s) => n + s.size, 0) +
    (status !== 'all' ? 1 : 0) +
    (source !== 'all' ? 1 : 0) +
    (cur !== 'all' ? 1 : 0) +
    (priceMin ? 1 : 0) +
    (priceMax ? 1 : 0);

  const clearAll = () => {
    setTraits({});
    setStatus('all');
    setSource('all');
    setCur('all');
    setPriceMin('');
    setPriceMax('');
  };

  const sidebar = (
    <FilterSidebar
      coll={coll}
      status={status}
      setStatus={setStatus}
      source={source}
      setSource={setSource}
      cur={cur}
      setCur={setCur}
      priceMin={priceMin}
      setPriceMin={setPriceMin}
      priceMax={priceMax}
      setPriceMax={setPriceMax}
      traitValues={traitValues}
      traits={traits}
      toggleTrait={toggleTrait}
      activeFilters={activeFilters}
      clearAll={clearAll}
    />
  );

  return (
    <div className="mx-auto max-w-[88rem] px-4 sm:px-6 py-10">
      <SectionTitle
        kicker="Marketplace"
        title="Browse the collections"
        subtitle="Every Badge & Harmie, filterable by trait, background, price and listing status. Zero marketplace fees."
      />

      {isPreview && (
        <div className="mb-6 rounded-xl border border-flare/20 bg-flare/[0.06] px-4 py-3 text-sm text-slate-300 flex items-start gap-2.5">
          <Info size={16} className="text-flare mt-0.5 shrink-0" />
          <span>
            <b className="text-slate-50">Live data unavailable.</b> Couldn't reach the marketplace
            right now, so these are sample listings. Prices update automatically once the live feed
            reconnects.
          </span>
        </div>
      )}

      {/* top bar */}
      <div className="panel p-3 sm:p-4 mb-6 sticky top-[4.5rem] z-30">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or number…"
              className="input !pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Segment
              options={[
                { v: 'all', label: 'All' },
                { v: 'badges', label: COLLECTIONS.badges.name },
                { v: 'harmies', label: COLLECTIONS.harmies.name },
              ]}
              value={coll}
              onChange={(v) => setCollection(v as CollFilter)}
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="input !w-auto !py-2 text-sm cursor-pointer"
            >
              <option value="recent">Recently listed</option>
              <option value="price-asc">Price: low → high</option>
              <option value="price-desc">Price: high → low</option>
              <option value="number">Token number</option>
            </select>
            {coll !== 'all' && (
              <button onClick={() => setFloorBid(true)} className="btn-ghost !py-2" title="Bid on the whole collection">
                <Gavel size={15} /> Collection offer
              </button>
            )}
            <div className="inline-flex rounded-xl bg-ink-900/70 border border-[color:var(--border)] p-1">
              {([
                ['single', Square, 'Single'],
                ['grid3', LayoutGrid, '3 columns'],
                ['grid5', Grid3x3, '5 columns'],
              ] as const).map(([v, Icon, label]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  title={label}
                  className={clsx(
                    'grid h-8 w-8 place-items-center rounded-lg transition',
                    view === v ? 'bg-[var(--active)] text-slate-50' : 'text-slate-400 hover:text-slate-50',
                  )}
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowFilters((s) => !s)}
              className="btn-ghost lg:hidden !py-2 relative"
            >
              <SlidersHorizontal size={15} /> Filters
              {activeFilters > 0 && (
                <span className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-neon text-[var(--on-accent)] text-[10px] font-bold">
                  {activeFilters}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* sidebar (desktop) */}
        <aside className="hidden lg:block w-64 shrink-0">
          <div className="sticky top-[9.5rem] max-h-[calc(100vh-11rem)] overflow-y-auto pr-1 no-scrollbar">
            {sidebar}
          </div>
        </aside>

        {/* mobile filters */}
        {showFilters && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowFilters(false)} />
            <div className="relative ml-auto w-80 max-w-[85vw] h-full bg-ink-900 border-l border-[color:var(--border)] p-4 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-bold">Filters</h3>
                <button onClick={() => setShowFilters(false)} className="btn-ghost !p-2 !rounded-lg">
                  <X size={18} />
                </button>
              </div>
              {sidebar}
            </div>
          </div>
        )}

        {/* grid */}
        <div className="flex-1 min-w-0">
          <div className="mb-4 flex items-center justify-between text-sm text-slate-400">
            <span className="flex items-center gap-2.5">
              {isLoading ? 'Loading…' : `${filtered.length.toLocaleString()} items`}
              {!isLoading && !isPreview && (
                <span className="chip border border-gboy/25 bg-gboy/10 text-gboy text-[10px]">
                  <span className="h-1.5 w-1.5 rounded-full bg-gboy animate-pulseGlow" /> Live · Magic Eden
                </span>
              )}
            </span>
            {activeFilters > 0 && (
              <button onClick={clearAll} className="text-neon hover:underline">
                Clear filters
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="panel aspect-[3/4] animate-pulse bg-ink-800/40" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="panel p-16 text-center text-slate-400">No items match your filters.</div>
          ) : (
            <>
              <div className={clsx('grid gap-4', VIEW_GRID[view])}>
                {filtered.slice(0, visible).map((a) => (
                  <MarketCard key={a.id} asset={a} listing={listingByAsset.get(a.id)} onBuy={setBuying} />
                ))}
              </div>
              {visible < filtered.length && (
                <div className="mt-8 flex justify-center">
                  <button onClick={() => setVisible((v) => v + PAGE)} className="btn-ghost !px-6 !py-3">
                    Load more ({filtered.length - visible} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <BuyDialog listing={buying} onClose={() => setBuying(null)} />
      {coll !== 'all' && (
        <MakeOfferDialog open={floorBid} onClose={() => setFloorBid(false)} collection={coll} />
      )}
    </div>
  );
}

function FilterSidebar(props: {
  coll: CollFilter;
  status: StatusFilter;
  setStatus: (s: StatusFilter) => void;
  source: SourceFilter;
  setSource: (s: SourceFilter) => void;
  cur: CurFilter;
  setCur: (c: CurFilter) => void;
  priceMin: string;
  setPriceMin: (s: string) => void;
  priceMax: string;
  setPriceMax: (s: string) => void;
  traitValues: Record<string, { value: string; count: number }[]> | null;
  traits: Record<string, Set<string>>;
  toggleTrait: (key: string, value: string) => void;
  activeFilters: number;
  clearAll: () => void;
}) {
  const { coll, status, setStatus, source, setSource, cur, setCur, priceMin, setPriceMin, priceMax, setPriceMax, traitValues, traits, toggleTrait } = props;

  const SOURCES: { v: SourceFilter; label: string; color?: string }[] = [
    { v: 'all',       label: 'All' },
    { v: 'neukomart', label: 'NEUKO',      color: ORIGIN_META.neukomart.color },
    { v: 'magiceden', label: 'Magic Eden', color: ORIGIN_META.magiceden.color },
    { v: 'tensor',    label: 'Tensor',     color: ORIGIN_META.tensor.color },
  ];

  return (
    <div className="space-y-5">
      {/* Source filter */}
      <FilterBlock title="Source">
        <div className="space-y-1.5">
          {SOURCES.map(({ v, label, color }) => {
            const active = source === v;
            return (
              <button
                key={v}
                onClick={() => setSource(v)}
                className={clsx(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium border transition',
                  active
                    ? 'border-neon/40 bg-neon/8 text-slate-50'
                    : 'border-[color:var(--border)] text-slate-400 hover:bg-[var(--hover)]',
                )}
              >
                {color ? (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: active ? color : undefined, background: active ? color : 'currentColor', opacity: active ? 1 : 0.4 }}
                  />
                ) : (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-slate-500 opacity-40" />
                )}
                <span className="flex-1 text-left">{label}</span>
                {active && <Check size={11} strokeWidth={3} className="text-neon shrink-0" />}
              </button>
            );
          })}
        </div>
      </FilterBlock>
      <FilterBlock title="Status">
        <div className="grid grid-cols-3 gap-1.5">
          {(['all', 'listed', 'unlisted'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={clsx('rounded-lg py-1.5 text-xs font-medium capitalize border transition', status === s ? 'border-neon/50 bg-neon/10 text-slate-50' : 'border-[color:var(--border)] text-slate-400 hover:bg-[var(--hover)]')}
            >
              {s}
            </button>
          ))}
        </div>
      </FilterBlock>

      <FilterBlock title="Currency">
        <div className="grid grid-cols-3 gap-1.5">
          {([['all', 'Any'], ['sol', 'SOL'], ['gboy', 'GBOY']] as [CurFilter, string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setCur(v)}
              className={clsx('flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium border transition', cur === v ? 'border-neon/50 bg-neon/10 text-slate-50' : 'border-[color:var(--border)] text-slate-400 hover:bg-[var(--hover)]')}
            >
              {v !== 'all' && <CurrencyIcon currency={v as Currency} size={12} />}
              {label}
            </button>
          ))}
        </div>
      </FilterBlock>

      <FilterBlock title="Price (listed)">
        <div className="flex items-center gap-2">
          <input value={priceMin} onChange={(e) => setPriceMin(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Min" inputMode="decimal" className="input !py-2 text-sm" />
          <span className="text-slate-600">–</span>
          <input value={priceMax} onChange={(e) => setPriceMax(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Max" inputMode="decimal" className="input !py-2 text-sm" />
        </div>
      </FilterBlock>

      {coll === 'all' ? (
        <div className="rounded-xl border border-dashed border-[color:var(--border)] p-3 text-xs text-slate-500">
          Select a collection above to filter by traits & background.
        </div>
      ) : (
        traitValues &&
        TRAIT_CONFIG[coll].map((cfg) => (
          <FilterBlock key={cfg.key} title={cfg.label}>
            {cfg.kind === 'color' ? (
              <div className="flex flex-wrap gap-2">
                {(traitValues[cfg.key] ?? []).map(({ value, count }) => {
                  const active = traits[cfg.key]?.has(value);
                  return (
                    <button
                      key={value}
                      onClick={() => toggleTrait(cfg.key, value)}
                      title={`${value} (${count})`}
                      className={clsx('relative h-8 w-8 rounded-lg border-2 transition', active ? 'border-neon scale-110' : 'border-[color:var(--border)] hover:border-white/30')}
                      style={{ background: swatchFor(value) }}
                    >
                      {active && (
                        <span className="absolute inset-0 grid place-items-center text-[var(--on-accent)]">
                          <Check size={14} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-1 max-h-52 overflow-y-auto pr-1 no-scrollbar">
                {(traitValues[cfg.key] ?? []).map(({ value, count }) => {
                  const active = traits[cfg.key]?.has(value);
                  return (
                    <button
                      key={value}
                      onClick={() => toggleTrait(cfg.key, value)}
                      className={clsx('flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs transition', active ? 'bg-neon/10 text-slate-50' : 'text-slate-400 hover:bg-[var(--hover)]')}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span className={clsx('grid h-3.5 w-3.5 shrink-0 place-items-center rounded border', active ? 'bg-neon border-neon text-[var(--on-accent)]' : 'border-[color:var(--border-strong)]')}>
                          {active && <Check size={10} strokeWidth={3} />}
                        </span>
                        <span className="truncate">{value}</span>
                      </span>
                      <span className="text-slate-600 tabular-nums">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </FilterBlock>
        ))
      )}
    </div>
  );
}

function FilterBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-3.5">
      <div className="label mb-2.5">{title}</div>
      {children}
    </div>
  );
}

function Segment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { v: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl bg-ink-900/70 border border-[color:var(--border)] p-1">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={clsx('px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap', value === o.v ? 'bg-[var(--active)] text-slate-50' : 'text-slate-400 hover:text-slate-50')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
