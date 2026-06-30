import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { Plus, X, ArrowRightLeft, Repeat2, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Modal, AssetImage, CurrencyIcon, SectionTitle, EcoBadge } from '../components/ui';
import { SelectableAssetCard } from '../components/NFTCard';
import { OfferCard } from '../components/OfferCard';
import { useMyAssets, useEcosystemAssets, useSwaps, useAssetsOf } from '../hooks/useWalletData';
import { shortAddress } from '../lib/format';
import { useMarketActions } from '../hooks/useMarketActions';
import { badgePubkeysByEmblem, badgeRepByEmblem } from '../lib/merkle';
import type { OnChainSwap } from '../lib/swaps';
import type { BadgeGroup, NeukoAsset, SwapSide } from '../lib/types';

const empty: SwapSide = { assets: [], sol: 0, gboy: 0 };

export function SwapStudio() {
  const { publicKey } = useWallet();
  const { assets: mine } = useMyAssets();
  const { assets: ecosystem } = useEcosystemAssets();
  const { data: swaps = [] } = useSwaps();
  const { createSwap, acceptSwap, cancelSwap } = useMarketActions();

  const [give, setGive] = useState<SwapSide>(empty);
  const [want, setWant] = useState<SwapSide>(empty);
  const [taker, setTaker] = useState('');
  const [picker, setPicker] = useState<'give' | 'want' | null>(null);
  const [tab, setTab] = useState<'open' | 'mine'>('open');
  const [counterId, setCounterId] = useState<string | null>(null);

  const me = publicKey?.toBase58();

  // When a counterparty is set, request from THEIR holdings so the maker picks
  // the exact asset that wallet can deliver (the swap locks exact assets).
  const takerAddr = useMemo(() => {
    const t = taker.trim();
    if (!t) return undefined;
    try {
      new PublicKey(t);
      return t;
    } catch {
      return undefined;
    }
  }, [taker]);
  const { data: takerAssets } = useAssetsOf(takerAddr);
  const directed = !!takerAddr && !!takerAssets && takerAssets.length > 0;
  const wantPool = directed ? takerAssets! : ecosystem;

  // emblem → representative badge artwork, so "any {emblem}" slots render the
  // real badge image (in the builder and on every offer card).
  const repByEmblem = useMemo(() => badgeRepByEmblem(ecosystem), [ecosystem]);

  const wantGroupCount = (want.groups ?? []).reduce((n, g) => n + g.count, 0);
  const valid =
    me &&
    (give.assets.length > 0 || give.sol > 0 || give.gboy > 0) &&
    (want.assets.length > 0 || wantGroupCount > 0 || want.sol > 0 || want.gboy > 0);

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
    await createSwap(give, want, taker.trim() || undefined, outgoingOffers, ecosystem);
    resetBuilder();
  };

  // Prefill the builder with the inverse of an offer to negotiate it.
  const startCounter = (offer: OnChainSwap) => {
    setGive({ assets: [...offer.want.assets], sol: offer.want.sol, gboy: offer.want.gboy });
    setWant({ assets: [...offer.give.assets], sol: offer.give.sol, gboy: offer.give.gboy });
    setTaker(offer.maker);
    setCounterId(offer.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`Countering — adjust the terms and submit`, { icon: '↔️' });
  };

  // Public board: only swaps open to anyone (no locked counterparty).
  const openOffers = swaps.filter((s) => s.status === 'open' && s.maker !== me && !s.taker);
  // Swaps a maker locked specifically TO me — I see them as incoming offers.
  const incomingOffers = swaps.filter((s) => s.status === 'open' && s.maker !== me && s.taker === me);
  // Swaps I created.
  const outgoingOffers = swaps.filter((s) => s.maker === me);
  // "My offers" = incoming (locked to me, I can accept) + my own outgoing.
  const myOffers = [...incomingOffers, ...outgoingOffers];

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
            repByEmblem={repByEmblem}
            onAddAssets={() => setPicker('want')}
            onRemoveAsset={(a) => setWant((s) => ({ ...s, assets: s.assets.filter((x) => x.id !== a.id) }))}
            onRemoveGroup={(emblem) => setWant((s) => ({ ...s, groups: (s.groups ?? []).filter((g) => g.emblem !== emblem) }))}
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
            Requests lock exact NFTs — set a counterparty to pick from their wallet, or request a specific asset anyone holding it can fill.
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
                  repByEmblem={repByEmblem}
                  onAccept={() => acceptSwap(o, outgoingOffers, ecosystem, mine)}
                  onCounter={() => startCounter(o)}
                />
              ))}
            </div>
          ))}

        {tab === 'mine' &&
          (myOffers.length === 0 ? (
            <Empty>No incoming offers, and you haven&apos;t created any swaps yet.</Empty>
          ) : (
            <div className="space-y-6">
              {incomingOffers.length > 0 && (
                <div>
                  <div className="label mb-3 text-neon">Incoming — locked to you ({incomingOffers.length})</div>
                  <div className="grid md:grid-cols-2 gap-4">
                    {incomingOffers.map((o) => (
                      <OfferCard
                        key={o.id}
                        offer={o}
                        incoming
                        repByEmblem={repByEmblem}
                        onAccept={() => acceptSwap(o, outgoingOffers, ecosystem, mine)}
                        onCounter={() => startCounter(o)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {outgoingOffers.length > 0 && (
                <div>
                  {incomingOffers.length > 0 && <div className="label mb-3">Your offers ({outgoingOffers.length})</div>}
                  <div className="grid md:grid-cols-2 gap-4">
                    {outgoingOffers.map((o) => (
                      <OfferCard
                        key={o.id}
                        offer={o}
                        mine
                        repByEmblem={repByEmblem}
                        onCancel={o.status === 'open' ? () => cancelSwap(o) : undefined}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
      </div>

      <AssetPickerModal
        open={picker !== null}
        title={
          picker === 'give'
            ? 'Select assets to give'
            : directed
              ? `Request from ${shortAddress(takerAddr, 4)}'s wallet`
              : 'Choose what to request'
        }
        pool={picker === 'give' ? mine : wantPool}
        ecosystem={ecosystem}
        selectedIds={(picker === 'give' ? give : want).assets.map((a) => a.id)}
        selectedGroups={picker === 'want' ? want.groups ?? [] : []}
        emptyHint={
          picker === 'give'
            ? 'Connect a wallet that holds Badges or Harmies.'
            : directed
              ? 'That counterparty holds no Badges or Harmies.'
              : 'No ecosystem assets indexed.'
        }
        mode={picker === 'want' ? 'want' : 'give'}
        onClose={() => setPicker(null)}
        onConfirm={(assets, groups) => {
          if (picker === 'give') setGive((s) => ({ ...s, assets }));
          else setWant((s) => ({ ...s, assets, groups }));
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
  repByEmblem,
  onAddAssets,
  onRemoveAsset,
  onRemoveGroup,
  onSol,
  onGboy,
}: {
  title: string;
  accent: 'neon' | 'harm';
  side: SwapSide;
  repByEmblem?: Map<string, NeukoAsset>;
  onAddAssets: () => void;
  onRemoveAsset: (a: NeukoAsset) => void;
  onRemoveGroup?: (emblem: string) => void;
  onSol: (v: number) => void;
  onGboy: (v: number) => void;
}) {
  const groups = side.groups ?? [];
  const empty = side.assets.length === 0 && groups.length === 0;
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
        {/* "any holder of this badge type" slots — shown with the real artwork. */}
        {groups.map((g) => {
          const rep = repByEmblem?.get(g.emblem);
          return (
            <div
              key={g.emblem}
              title={`Any ${g.emblem} Badge${g.count > 1 ? ` ×${g.count}` : ''}`}
              className="relative group aspect-square overflow-hidden rounded-xl border border-neon/40"
            >
              {rep ? (
                <AssetImage asset={rep} rounded="rounded-none" />
              ) : (
                <div className="h-full w-full grid place-items-center bg-neon/10 text-neon text-[10px] font-bold text-center px-1">
                  {g.emblem}
                </div>
              )}
              {g.count > 1 && (
                <span className="absolute top-1 left-1 grid h-5 min-w-[1.25rem] px-1 place-items-center rounded-full bg-neon text-[var(--on-accent)] text-[10px] font-bold tabular-nums">
                  ×{g.count}
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-neon/85 text-[var(--on-accent)] text-[9px] font-bold text-center leading-snug tracking-wide truncate px-1">
                ANY {g.emblem.toUpperCase()}
              </span>
              {onRemoveGroup && (
                <button
                  onClick={() => onRemoveGroup(g.emblem)}
                  className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-ink-950/80 text-slate-300 opacity-0 group-hover:opacity-100 transition"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
        {empty && (
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
  // Hold the raw text locally so intermediate decimal states ("0", "0.", "0.00")
  // survive — storing only the parsed number reset the field on every keystroke,
  // which made fractional amounts like 0.0001 impossible to type.
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => {
    // Re-sync only on genuine external changes (counter prefill / reset), never
    // while typing — when typing, parseFloat(text) already equals value.
    if ((parseFloat(text) || 0) !== value) setText(value ? String(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2">
        <CurrencyIcon currency={currency} size={15} />
      </span>
      <input
        value={text}
        onChange={(e) => {
          let raw = e.target.value.replace(/[^0-9.]/g, '');
          const dot = raw.indexOf('.');
          if (dot !== -1) raw = raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, '');
          setText(raw);
          onChange(parseFloat(raw) || 0);
        }}
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
  ecosystem,
  selectedIds,
  selectedGroups,
  emptyHint,
  onClose,
  onConfirm,
  mode = 'give',
}: {
  open: boolean;
  title: string;
  pool: NeukoAsset[];
  /** Full ecosystem — badge types ("any holder") are derived from this. */
  ecosystem: NeukoAsset[];
  selectedIds: string[];
  selectedGroups: BadgeGroup[];
  emptyHint: string;
  onClose: () => void;
  onConfirm: (assets: NeukoAsset[], groups: BadgeGroup[]) => void;
  /** 'want' mode also offers "any holder of this badge type" slots. */
  mode?: 'give' | 'want';
}) {
  const [sel, setSel] = useState<Record<string, NeukoAsset>>({});
  const [selGroups, setSelGroups] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState('');

  // seed selection from existing
  useMemo(() => {
    if (!open) return;
    const init: Record<string, NeukoAsset> = {};
    pool.forEach((a) => { if (selectedIds.includes(a.id)) init[a.id] = a; });
    setSel(init);
    const g: Record<string, number> = {};
    for (const grp of selectedGroups) g[grp.emblem] = grp.count;
    setSelGroups(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Badge types available across the whole ecosystem (want mode only): each emblem
  // becomes an "any holder of this type" slot. The max requestable is how many of
  // that emblem exist.
  const badgeTypes = useMemo(() => {
    if (mode !== 'want') return [] as { emblem: string; representative: NeukoAsset; available: number }[];
    const byEmblem = badgePubkeysByEmblem(ecosystem);
    const rep = new Map<string, NeukoAsset>();
    for (const a of ecosystem) {
      if (a.collection !== 'badges') continue;
      const e = a.attributes.find((at) => at.trait_type === 'Emblem')?.value;
      if (e && !rep.has(e)) rep.set(e, a);
    }
    return [...byEmblem.entries()]
      .map(([emblem, pubkeys]) => ({ emblem, representative: rep.get(emblem)!, available: pubkeys.length }))
      .filter((b) => b.representative)
      .sort((a, b) => a.emblem.localeCompare(b.emblem));
  }, [ecosystem, mode]);

  const filtered = pool
    .filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()))
    .slice(0, 120);

  const toggle = (a: NeukoAsset) =>
    setSel((s) => {
      const n = { ...s };
      if (n[a.id]) delete n[a.id];
      else n[a.id] = a;
      return n;
    });

  const setGroupQty = (emblem: string, qty: number) =>
    setSelGroups((s) => {
      const n = { ...s };
      if (qty <= 0) delete n[emblem];
      else n[emblem] = qty;
      return n;
    });

  const groupTotal = Object.values(selGroups).reduce((a, b) => a + b, 0);
  const totalSelected = Object.keys(sel).length + groupTotal;

  const handleConfirm = () =>
    onConfirm(
      Object.values(sel),
      Object.entries(selGroups).map(([emblem, count]) => ({ emblem, count })),
    );

  const nothing = filtered.length === 0 && badgeTypes.length === 0;

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-3xl">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name or number…"
        className="input mb-4"
      />
      {nothing ? (
        <div className="py-12 text-center text-slate-400">{emptyHint}</div>
      ) : (
        <div className="max-h-[50vh] overflow-y-auto pr-1 space-y-4">
          {/* Badge types — any holder of this emblem can fill the slot. */}
          {mode === 'want' && badgeTypes.length > 0 && (
            <div>
              <div className="label mb-2 text-neon">Badge type — anyone holding this badge can fill</div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
                {badgeTypes
                  .filter((b) => `${b.emblem} badge`.toLowerCase().includes(filter.toLowerCase()))
                  .map((b) => (
                    <BadgeTypeCard
                      key={b.emblem}
                      emblem={b.emblem}
                      representative={b.representative}
                      available={b.available}
                      qty={selGroups[b.emblem] ?? 0}
                      onChange={(q) => setGroupQty(b.emblem, q)}
                    />
                  ))}
              </div>
            </div>
          )}
          {/* Specific NFTs. */}
          {filtered.length > 0 && (
            <div>
              {mode === 'want' && <div className="label mb-2 text-harm">Or request a specific NFT</div>}
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
                {filtered.map((a) => (
                  <SelectableAssetCard
                    key={a.id}
                    asset={a}
                    selected={!!sel[a.id]}
                    onToggle={toggle}
                    // Can't offer a listed (frozen) NFT in a swap — it's escrowed elsewhere.
                    disabled={mode === 'give' && !!a.frozen}
                    lockedLabel={mode === 'give' && a.frozen ? 'LISTED' : undefined}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-slate-400">{totalSelected} selected</span>
        <div className="flex gap-2">
          <button onClick={() => { setSel({}); setSelGroups({}); }} className="btn-ghost !py-2">
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

function BadgeTypeCard({
  emblem,
  representative,
  available,
  qty,
  onChange,
}: {
  emblem: string;
  representative: NeukoAsset;
  available: number;
  qty: number;
  onChange: (qty: number) => void;
}) {
  const max = Math.min(available, 8);
  return (
    <div className={clsx('relative panel overflow-hidden text-left transition-all', qty > 0 ? 'ring-2 ring-neon shadow-glow' : 'hover:-translate-y-0.5')}>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, qty + 1))}
        title={`Request any ${emblem} Badge`}
        className="block w-full relative aspect-square overflow-hidden"
      >
        <AssetImage asset={representative} rounded="rounded-none" />
        {qty > 0 && (
          <span className="absolute top-1.5 right-1.5 grid h-6 min-w-[1.5rem] px-1.5 place-items-center rounded-full bg-neon text-[var(--on-accent)] text-xs font-bold tabular-nums">
            ×{qty}
          </span>
        )}
      </button>
      <div className="p-2.5">
        <div className="text-xs font-semibold truncate">Any {emblem}</div>
        <div className="mt-1.5 flex items-center justify-between gap-1">
          <span className="text-[10px] text-slate-500">{available} exist</span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={qty <= 0} onClick={() => onChange(Math.max(0, qty - 1))} className="grid h-6 w-6 place-items-center rounded-md border border-[color:var(--border)] text-slate-300 hover:bg-[var(--hover)] disabled:opacity-30 disabled:cursor-not-allowed">−</button>
            <span className="w-4 text-center text-xs tabular-nums">{qty}</span>
            <button type="button" disabled={qty >= max} onClick={() => onChange(Math.min(max, qty + 1))} className="grid h-6 w-6 place-items-center rounded-md border border-[color:var(--border)] text-slate-300 hover:bg-[var(--hover)] disabled:opacity-30 disabled:cursor-not-allowed">+</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="panel p-12 text-center text-slate-400">{children}</div>;
}
