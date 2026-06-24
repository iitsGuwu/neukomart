import { useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Plus, X, ArrowRightLeft, Repeat2, Trash2, Check } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Modal, AssetImage, CurrencyIcon, SectionTitle, EcoBadge } from '../components/ui';
import { SelectableAssetCard } from '../components/NFTCard';
import { OfferCard } from '../components/OfferCard';
import { useMyAssets, useEcosystemAssets } from '../hooks/useWalletData';
import { useMarketActions } from '../hooks/useMarketActions';
import { useMarketState } from '../lib/store';
import type { NeukoAsset, SwapSide, SwapOffer } from '../lib/types';

const empty: SwapSide = { assets: [], sol: 0, gboy: 0 };

export function SwapStudio() {
  const { publicKey } = useWallet();
  const { assets: mine } = useMyAssets();
  const { assets: ecosystem } = useEcosystemAssets();
  const market = useMarketState();
  const { createSwap, acceptSwap, cancelSwap } = useMarketActions();

  const [give, setGive] = useState<SwapSide>(empty);
  const [want, setWant] = useState<SwapSide>(empty);
  const [taker, setTaker] = useState('');
  const [picker, setPicker] = useState<'give' | 'want' | null>(null);
  const [tab, setTab] = useState<'open' | 'mine'>('open');
  const [counterId, setCounterId] = useState<string | null>(null);

  const me = publicKey?.toBase58();

  const valid =
    me &&
    (give.assets.length > 0 || give.sol > 0 || give.gboy > 0) &&
    (want.assets.length > 0 || want.sol > 0 || want.gboy > 0);

  const resetBuilder = () => {
    setGive(empty);
    setWant(empty);
    setTaker('');
    setCounterId(null);
  };

  const submit = async () => {
    if (!valid) {
      toast.error('Add something to both sides of the trade');
      return;
    }
    await createSwap(give, want, taker.trim() || undefined, counterId ?? undefined);
    resetBuilder();
  };

  // Prefill the builder with the inverse of an offer to negotiate it.
  const startCounter = (offer: SwapOffer) => {
    setGive({ assets: [...offer.want.assets], sol: offer.want.sol, gboy: offer.want.gboy });
    setWant({ assets: [...offer.give.assets], sol: offer.give.sol, gboy: offer.give.gboy });
    setTaker(offer.maker);
    setCounterId(offer.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`Countering — adjust the terms and submit`, { icon: '↔️' });
  };

  const openOffers = market.swaps.filter((s) => s.status === 'open' && s.maker !== me);
  const myOffers = market.swaps.filter((s) => s.maker === me);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <SectionTitle
        kicker="Swap Studio"
        title="Barter anything in the ecosystem"
        subtitle="NFT-for-NFT, many-for-one, or any mix sweetened with SOL or $GBOY on either side. Build your deal, set a counterparty (optional), and settle atomically."
      />

      {counterId && (
        <div className="mb-4 panel p-3.5 flex items-center justify-between gap-3 border border-flare/30 bg-flare/[0.06]">
          <span className="text-sm text-slate-300 flex items-center gap-2">
            <ArrowRightLeft size={15} className="text-flare" />
            Countering an offer — the terms are pre-filled with the inverse. Adjust and submit.
          </span>
          <button onClick={resetBuilder} className="btn-ghost !py-1.5 text-xs">
            Clear
          </button>
        </div>
      )}

      {/* BUILDER */}
      <div className="panel p-5 sm:p-7">
        <div className="grid lg:grid-cols-[1fr_auto_1fr] gap-5 items-stretch">
          <SwapSidePanel
            title="You give"
            accent="neon"
            side={give}
            onAddAssets={() => setPicker('give')}
            onRemoveAsset={(a) => setGive((s) => ({ ...s, assets: s.assets.filter((x) => x.id !== a.id) }))}
            onSol={(v) => setGive((s) => ({ ...s, sol: v }))}
            onGboy={(v) => setGive((s) => ({ ...s, gboy: v }))}
          />

          <div className="hidden lg:flex flex-col items-center justify-center px-2">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-ink-800 border border-harm/40 shadow-glow-harm text-harm">
              <ArrowRightLeft size={20} />
            </div>
          </div>

          <SwapSidePanel
            title="You want"
            accent="harm"
            side={want}
            onAddAssets={() => setPicker('want')}
            onRemoveAsset={(a) => setWant((s) => ({ ...s, assets: s.assets.filter((x) => x.id !== a.id) }))}
            onSol={(v) => setWant((s) => ({ ...s, sol: v }))}
            onGboy={(v) => setWant((s) => ({ ...s, gboy: v }))}
          />
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <div className="flex-1 max-w-sm">
            <label className="label">Counterparty (optional)</label>
            <input
              value={taker}
              onChange={(e) => setTaker(e.target.value)}
              placeholder="Lock to a specific wallet, or leave open"
              className="input mt-1.5 font-mono text-xs"
            />
          </div>
          <button onClick={submit} disabled={!valid} className="btn-primary !px-6 !py-3 shrink-0">
            <Repeat2 size={16} /> {counterId ? 'Submit counter offer' : 'Create swap offer'}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-y-2 items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex flex-wrap gap-2">
            <EcoBadge tone="gboy">0% fee</EcoBadge>
            <EcoBadge tone="neon">Atomic settlement</EcoBadge>
            <EcoBadge tone="harm">Escrow-backed</EcoBadge>
          </div>
          <span className="text-slate-400">
            Note: Badge type selection is for UI; the on-chain trade locks the exact badge selected.
          </span>
        </div>
      </div>

      {/* OFFERS */}
      <div className="mt-12">
        <div className="flex items-center gap-2 mb-5">
          {(['open', 'mine'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'px-4 py-2 rounded-lg text-sm font-semibold transition',
                tab === t ? 'bg-[var(--active)] text-slate-50' : 'text-slate-400 hover:text-slate-50',
              )}
            >
              {t === 'open' ? `Open offers (${openOffers.length})` : `My offers (${myOffers.length})`}
            </button>
          ))}
        </div>

        {tab === 'open' &&
          (openOffers.length === 0 ? (
            <Empty>No open swap offers right now.</Empty>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {openOffers.map((o) => (
                <OfferCard
                  key={o.id}
                  offer={o}
                  onAccept={() => acceptSwap(o.id)}
                  onCounter={() => startCounter(o)}
                />
              ))}
            </div>
          ))}

        {tab === 'mine' &&
          (myOffers.length === 0 ? (
            <Empty>You haven&apos;t created any swap offers yet.</Empty>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {myOffers.map((o) => (
                <OfferCard
                  key={o.id}
                  offer={o}
                  mine
                  onCancel={o.status === 'open' ? () => cancelSwap(o.id) : undefined}
                />
              ))}
            </div>
          ))}
      </div>

      <AssetPickerModal
        open={picker !== null}
        title={picker === 'give' ? 'Select assets to give' : 'Select assets to request'}
        pool={picker === 'give' ? mine : ecosystem}
        selectedIds={(picker === 'give' ? give : want).assets.map((a) => a.id)}
        emptyHint={
          picker === 'give'
            ? 'Connect a wallet that holds Badges or Harmies.'
            : 'No ecosystem assets indexed.'
        }
        mode={picker === 'want' ? 'want' : 'give'}
        onClose={() => setPicker(null)}
        onConfirm={(assets) => {
          if (picker === 'give') setGive((s) => ({ ...s, assets }));
          else setWant((s) => ({ ...s, assets }));
          setPicker(null);
        }}
      />
    </div>
  );
}

function SwapSidePanel({
  title,
  accent,
  side,
  onAddAssets,
  onRemoveAsset,
  onSol,
  onGboy,
}: {
  title: string;
  accent: 'neon' | 'harm';
  side: SwapSide;
  onAddAssets: () => void;
  onRemoveAsset: (a: NeukoAsset) => void;
  onSol: (v: number) => void;
  onGboy: (v: number) => void;
}) {
  return (
    <div className={clsx('rounded-2xl border p-4', accent === 'neon' ? 'border-neon/20 bg-neon/[0.03]' : 'border-harm/20 bg-harm/[0.03]')}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={clsx('font-display font-bold', accent === 'neon' ? 'text-neon' : 'text-harm')}>{title}</h3>
        <button onClick={onAddAssets} className="btn-ghost !py-1.5 !px-3 text-xs">
          <Plus size={14} /> Add NFTs
        </button>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 min-h-[5.5rem]">
        {side.assets.map((a) => (
          <div key={a.id} className="relative group aspect-square overflow-hidden rounded-xl border border-[color:var(--border)]">
            <AssetImage asset={a} rounded="rounded-none" />
            <button
              onClick={() => onRemoveAsset(a)}
              className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-ink-950/80 text-slate-300 opacity-0 group-hover:opacity-100 transition"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {side.assets.length === 0 && (
          <button
            onClick={onAddAssets}
            className="col-span-3 sm:col-span-4 grid place-items-center rounded-xl border border-dashed border-[color:var(--border)] text-slate-500 text-sm h-[5.5rem] hover:border-[color:var(--border-strong)] hover:text-slate-300 transition"
          >
            <span className="flex flex-col items-center gap-1">
              <Plus size={18} /> Add NFTs
            </span>
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <AmountInput currency="sol" value={side.sol} onChange={onSol} />
        <AmountInput currency="gboy" value={side.gboy} onChange={onGboy} />
      </div>
    </div>
  );
}

function AmountInput({
  currency,
  value,
  onChange,
}: {
  currency: 'sol' | 'gboy';
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2">
        <CurrencyIcon currency={currency} size={15} />
      </span>
      <input
        value={value || ''}
        onChange={(e) => onChange(parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
        inputMode="decimal"
        placeholder="0"
        className="input !pl-9 !py-2 text-sm tabular-nums"
      />
    </div>
  );
}

function AssetPickerModal({
  open,
  title,
  pool,
  selectedIds,
  emptyHint,
  onClose,
  onConfirm,
  mode = 'give',
}: {
  open: boolean;
  title: string;
  pool: NeukoAsset[];
  selectedIds: string[];
  emptyHint: string;
  onClose: () => void;
  onConfirm: (assets: NeukoAsset[]) => void;
  /** 'want' mode groups badges by type instead of showing individual NFTs. */
  mode?: 'give' | 'want';
}) {
  const [sel, setSel] = useState<Record<string, NeukoAsset>>({});
  const [selTypes, setSelTypes] = useState<Record<string, BadgeTypeEntry>>({});
  const [filter, setFilter] = useState('');

  // seed selection from existing
  useMemo(() => {
    if (open) {
      const init: Record<string, NeukoAsset> = {};
      pool.forEach((a) => selectedIds.includes(a.id) && (init[a.id] = a));
      setSel(init);
      // Restore badge type selections from existing selectedIds
      if (mode === 'want') {
        const initTypes: Record<string, BadgeTypeEntry> = {};
        pool.forEach((a) => {
          if (a.collection === 'badges' && selectedIds.includes(a.id)) {
            const emblem = a.attributes.find((at) => at.trait_type === 'Emblem')?.value;
            if (emblem && !initTypes[emblem]) {
              initTypes[emblem] = { emblem, representative: a };
            }
          }
        });
        setSelTypes(initTypes);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // In 'want' mode, split pool into harmies (individual) and badge types (grouped).
  const badgeTypes = useMemo(() => {
    if (mode !== 'want') return [];
    const groups = new Map<string, BadgeTypeEntry>();
    for (const a of pool) {
      if (a.collection !== 'badges') continue;
      const emblem = a.attributes.find((at) => at.trait_type === 'Emblem')?.value;
      if (!emblem) continue;
      if (!groups.has(emblem)) {
        groups.set(emblem, { emblem, representative: a });
      }
    }
    return [...groups.values()].sort((a, b) => a.emblem.localeCompare(b.emblem));
  }, [pool, mode]);

  const harmies = mode === 'want' ? pool.filter((a) => a.collection === 'harmies') : pool;

  const filtered = harmies
    .filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()))
    .slice(0, 120);

  const filteredBadgeTypes = badgeTypes.filter((bt) =>
    `${bt.emblem} badge`.toLowerCase().includes(filter.toLowerCase()),
  );

  const toggle = (a: NeukoAsset) =>
    setSel((s) => {
      const n = { ...s };
      if (n[a.id]) delete n[a.id];
      else n[a.id] = a;
      return n;
    });

  const toggleBadgeType = (bt: BadgeTypeEntry) =>
    setSelTypes((s) => {
      const n = { ...s };
      if (n[bt.emblem]) delete n[bt.emblem];
      else n[bt.emblem] = bt;
      return n;
    });

  const totalSelected = Object.keys(sel).length + (mode === 'want' ? Object.keys(selTypes).length : 0);

  const handleConfirm = () => {
    const assets = [...Object.values(sel)];
    // Add one representative badge per selected type
    if (mode === 'want') {
      for (const bt of Object.values(selTypes)) {
        // Don't double-add if it's already individually selected
        if (!assets.some((a) => a.id === bt.representative.id)) {
          assets.push(bt.representative);
        }
      }
    }
    onConfirm(assets);
  };

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-3xl">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter…"
        className="input mb-4"
      />
      {filtered.length === 0 && filteredBadgeTypes.length === 0 ? (
        <div className="py-12 text-center text-slate-400">{emptyHint}</div>
      ) : (
        <div className="max-h-[50vh] overflow-y-auto pr-1">
          {/* Badge types (want mode only) */}
          {mode === 'want' && filteredBadgeTypes.length > 0 && (
            <>
              <div className="label mb-2 text-neon">Badge type (any holder can fill)</div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5 mb-4">
                {filteredBadgeTypes.map((bt) => (
                  <BadgeTypeCard
                    key={bt.emblem}
                    entry={bt}
                    selected={!!selTypes[bt.emblem]}
                    onToggle={toggleBadgeType}
                  />
                ))}
              </div>
            </>
          )}
          {/* Individual NFTs */}
          {filtered.length > 0 && (
            <>
              {mode === 'want' && <div className="label mb-2 text-harm">Harmies (specific NFT)</div>}
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
                {filtered.map((a) => (
                  <SelectableAssetCard key={a.id} asset={a} selected={!!sel[a.id]} onToggle={toggle} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-slate-400">{totalSelected} selected</span>
        <div className="flex gap-2">
          <button onClick={() => { setSel({}); setSelTypes({}); }} className="btn-ghost !py-2">
            <Trash2 size={14} /> Clear
          </button>
          <button onClick={handleConfirm} className="btn-primary !py-2">
            Add to trade
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface BadgeTypeEntry {
  emblem: string;
  representative: NeukoAsset;
}

function BadgeTypeCard({
  entry,
  selected,
  onToggle,
}: {
  entry: BadgeTypeEntry;
  selected: boolean;
  onToggle: (e: BadgeTypeEntry) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(entry)}
      className={clsx(
        'relative panel overflow-hidden text-left transition-all',
        selected ? 'ring-2 ring-neon shadow-glow' : 'hover:-translate-y-0.5',
      )}
    >
      <div className="relative aspect-square overflow-hidden">
        <AssetImage asset={entry.representative} rounded="rounded-none" />
        {selected && (
          <div className="absolute inset-0 bg-neon/15 grid place-items-center">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-neon text-[var(--on-accent)]">
              <Check size={18} strokeWidth={3} />
            </span>
          </div>
        )}
      </div>
      <div className="p-2.5">
        <div className="text-xs font-semibold truncate">{entry.emblem} Badge</div>
        <div className="text-[10px] text-slate-500">Any #{entry.emblem}</div>
      </div>
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="panel p-12 text-center text-slate-400">{children}</div>;
}
