import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Tag, Repeat2, ShoppingBag, Send, List, LineChart as LineIcon, TrendingUp, TrendingDown } from 'lucide-react';
import clsx from 'clsx';
import { AssetImage, PriceTag, SectionTitle, CurrencyIcon } from '../components/ui';
import { LineChart, BarChart } from '../components/Charts';
import { useMarketState } from '../lib/store';
import { shortAddress, timeAgo } from '../lib/format';
import { COLLECTIONS, type CollectionKey } from '../lib/constants';
import { volumeHistory, floorHistory, sumVolume, pctChange, hasRealHistory } from '../lib/analytics';
import type { ActivityKind } from '../lib/types';

const KIND_META: Record<ActivityKind, { label: string; icon: typeof Tag; tone: string }> = {
  sale: { label: 'Sale', icon: ShoppingBag, tone: 'text-gboy bg-gboy/10 border-gboy/25' },
  list: { label: 'Listing', icon: Tag, tone: 'text-neon bg-neon/10 border-neon/25' },
  swap: { label: 'Swap', icon: Repeat2, tone: 'text-harm bg-harm/10 border-harm/25' },
  offer: { label: 'Offer', icon: Send, tone: 'text-flare bg-flare/10 border-flare/25' },
};

type KindFilter = 'all' | ActivityKind;
type CollFilter = 'all' | CollectionKey;
const RANGES = [7, 30, 90] as const;

export function Activity() {
  const market = useMarketState();
  const [view, setView] = useState<'feed' | 'analytics'>('feed');
  const [kind, setKind] = useState<KindFilter>('all');
  const [coll, setColl] = useState<CollFilter>('all');
  const [range, setRange] = useState<number>(30);
  const [floorColl, setFloorColl] = useState<CollectionKey>('harmies');

  const items = useMemo(() => {
    return [...market.activity]
      .filter((it) => (kind === 'all' ? true : it.kind === kind))
      .filter((it) => (coll === 'all' ? true : it.asset?.collection === coll))
      .sort((a, b) => b.time - a.time);
  }, [market.activity, kind, coll]);

  const volume = useMemo(() => volumeHistory(market.activity, range), [market.activity, range]);
  const floor = useMemo(
    () => floorHistory(market.listings, market.activity, floorColl, range),
    [market.listings, market.activity, floorColl, range],
  );
  const real = useMemo(() => hasRealHistory(market.activity, range), [market.activity, range]);
  const floorChange = pctChange(floor);
  const volChange = pctChange(volume);

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
      <SectionTitle kicker="Activity" title="Ecosystem feed" subtitle="Listings, sales and swaps across Badges & Harmies — plus volume and floor analytics." />

      {/* view toggle */}
      <div className="flex items-center gap-2 mb-6">
        {([['feed', List, 'Feed'], ['analytics', LineIcon, 'Analytics']] as const).map(([v, Icon, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={clsx(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition',
              view === v ? 'bg-[var(--active)] text-slate-50' : 'text-slate-400 hover:text-slate-50',
            )}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {view === 'feed' ? (
        <>
          {/* filters */}
          <div className="flex flex-wrap gap-2 mb-5">
            <Chips
              value={kind}
              onChange={(v) => setKind(v as KindFilter)}
              options={[
                ['all', 'All'],
                ['sale', 'Sales'],
                ['list', 'Listings'],
                ['swap', 'Swaps'],
                ['offer', 'Offers'],
              ]}
            />
            <Chips
              value={coll}
              onChange={(v) => setColl(v as CollFilter)}
              options={[
                ['all', 'All collections'],
                ['badges', COLLECTIONS.badges.name],
                ['harmies', COLLECTIONS.harmies.name],
              ]}
            />
          </div>

          <div className="panel divide-y divide-[color:var(--border)]">
            {items.length === 0 && <div className="p-12 text-center text-slate-400">No activity matches these filters.</div>}
            {items.map((it) => {
              const meta = KIND_META[it.kind];
              const Icon = meta.icon;
              return (
                <div key={it.id} className="flex items-center gap-4 p-3.5 hover:bg-[var(--soft)] transition">
                  {it.asset ? (
                    <Link to={`/asset/${it.asset.id}`} className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-[color:var(--border)]">
                      <AssetImage asset={it.asset} rounded="rounded-none" />
                    </Link>
                  ) : (
                    <div className="h-12 w-12 shrink-0 rounded-xl bg-ink-800" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={clsx('chip border text-[10px]', meta.tone)}>
                        <Icon size={11} /> {meta.label}
                      </span>
                      {it.asset && (
                        <Link to={`/asset/${it.asset.id}`} className="text-sm font-semibold truncate hover:text-neon">
                          {it.asset.name}
                        </Link>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 font-mono">
                      {it.from && <>from {shortAddress(it.from, 4)}</>}
                      {it.to && <> → {shortAddress(it.to, 4)}</>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {it.price != null && it.currency && <PriceTag amount={it.price} currency={it.currency} size="sm" />}
                    <div className="text-xs text-slate-500 mt-0.5">{timeAgo(it.time)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {/* range */}
          <div className="flex items-center justify-end gap-1.5 mb-4">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold border transition',
                  range === r ? 'border-neon/50 bg-neon/10 text-slate-50' : 'border-[color:var(--border)] text-slate-400 hover:bg-[var(--hover)]',
                )}
              >
                {r}D
              </button>
            ))}
          </div>

          {/* volume */}
          <div className="panel p-5 mb-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="label">Trading volume ({range}D)</div>
                <div className="mt-1 font-display text-2xl font-bold flex items-center gap-2">
                  <CurrencyIcon currency="sol" size={18} />
                  {sumVolume(volume).toLocaleString('en-US', {
                    maximumFractionDigits: sumVolume(volume) >= 100 ? 0 : 2,
                  })}
                  <Delta pct={volChange} />
                </div>
              </div>
            </div>
            <BarChart data={volume} color="#ff2222" height={200} format={(v) => v.toFixed(0)} />
          </div>

          {/* floor */}
          <div className="panel p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="label">Floor price ({range}D)</div>
                <div className="mt-1 font-display text-2xl font-bold flex items-center gap-2">
                  <PriceTag amount={floor[floor.length - 1]?.v ?? 0} currency="sol" />
                  <Delta pct={floorChange} />
                </div>
              </div>
              <div className="inline-flex rounded-xl bg-ink-900/70 border border-[color:var(--border)] p-1">
                {(['badges', 'harmies'] as CollectionKey[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setFloorColl(c)}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-xs font-semibold transition',
                      floorColl === c ? 'bg-[var(--active)] text-slate-50' : 'text-slate-400 hover:text-slate-50',
                    )}
                  >
                    {COLLECTIONS[c].name}
                  </button>
                ))}
              </div>
            </div>
            <LineChart data={floor} color={floorColl === 'harmies' ? '#a98bff' : '#ff2222'} height={220} format={(v) => v.toFixed(2)} />
          </div>

          <p className="mt-4 text-xs text-slate-500 text-center">
            {real
              ? `Built from real sales indexed over the last ${range} days; floor anchors to the live listing floor.`
              : 'No sales recorded in this window yet — the curves are modelled and anchored to the live floor until trade history accrues.'}
          </p>
        </>
      )}
    </div>
  );
}

function Chips({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="inline-flex rounded-xl bg-ink-900/70 border border-[color:var(--border)] p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={clsx(
            'px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap',
            value === v ? 'bg-[var(--active)] text-slate-50' : 'text-slate-400 hover:text-slate-50',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Delta({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span className={clsx('text-sm font-semibold inline-flex items-center gap-0.5', up ? 'text-gboy' : 'text-flare')}>
      {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}
