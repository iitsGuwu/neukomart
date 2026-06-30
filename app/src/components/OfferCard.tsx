import clsx from 'clsx';
import { ArrowRight, Check, Clock, Repeat2, X } from 'lucide-react';
import { AssetImage, CurrencyIcon } from './ui';
import { shortAddress, timeAgo, formatAmount } from '../lib/format';
import type { SwapOffer, SwapSide, NeukoAsset } from '../lib/types';

/** A "any holder of this emblem" slot, shown with the real badge artwork. */
function GroupTile({ emblem, count, rep }: { emblem: string; count: number; rep?: NeukoAsset }) {
  return (
    <div
      title={`Any ${emblem} Badge${count > 1 ? ` ×${count}` : ''}`}
      className="relative h-12 w-12 overflow-hidden rounded-lg border border-neon/40"
    >
      {rep ? (
        <AssetImage asset={rep} rounded="rounded-none" />
      ) : (
        <div className="h-full w-full grid place-items-center bg-neon/10 text-neon text-[8px] font-bold text-center px-0.5 leading-tight">
          {emblem}
        </div>
      )}
      {count > 1 && (
        <span className="absolute top-0.5 right-0.5 grid h-4 min-w-[1rem] px-1 place-items-center rounded-full bg-neon text-[var(--on-accent)] text-[9px] font-bold tabular-nums leading-none">
          ×{count}
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-neon/85 text-[var(--on-accent)] text-[8px] font-bold text-center leading-[1.45] tracking-wide">
        ANY
      </span>
    </div>
  );
}

function SideStack({ side, label, repByEmblem }: { side: SwapSide; label: string; repByEmblem?: Map<string, NeukoAsset> }) {
  const hasMoney = side.sol > 0 || side.gboy > 0;
  const groups = side.groups ?? [];
  return (
    <div className="flex-1 min-w-0">
      <div className="label mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {side.assets.map((a) => (
          <div key={a.id} className="h-12 w-12 overflow-hidden rounded-lg border border-[color:var(--border)]" title={a.name}>
            <AssetImage asset={a} rounded="rounded-none" />
          </div>
        ))}
        {groups.map((g) => (
          <GroupTile key={g.emblem} emblem={g.emblem} count={g.count} rep={repByEmblem?.get(g.emblem)} />
        ))}
        {side.assets.length === 0 && groups.length === 0 && !hasMoney && (
          <span className="text-xs text-slate-500">—</span>
        )}
      </div>
      {hasMoney && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {side.sol > 0 && (
            <span className="chip bg-ink-900/70 border border-[color:var(--border)] text-slate-200">
              <CurrencyIcon currency="sol" size={12} /> {formatAmount(side.sol, 'sol')}
            </span>
          )}
          {side.gboy > 0 && (
            <span className="chip bg-ink-900/70 border border-[color:var(--border)] text-slate-200">
              <CurrencyIcon currency="gboy" size={12} /> {formatAmount(side.gboy, 'gboy')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function OfferCard({
  offer,
  mine,
  incoming,
  repByEmblem,
  onAccept,
  onCancel,
  onCounter,
  onRefuse,
}: {
  offer: SwapOffer;
  mine?: boolean;
  /** This swap is locked specifically to the viewer (an incoming offer). */
  incoming?: boolean;
  /** emblem → representative badge asset, so "any {emblem}" slots show artwork. */
  repByEmblem?: Map<string, NeukoAsset>;
  onAccept?: () => void;
  onCancel?: () => void;
  onCounter?: () => void;
  /** Refuse an incoming swap — locally hides it from the viewer's list. */
  onRefuse?: () => void;
}) {
  const statusTone =
    offer.status === 'open'
      ? 'text-gboy'
      : offer.status === 'accepted'
        ? 'text-neon'
        : 'text-slate-500';

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-slate-400">
          by <span className="font-mono text-slate-200">{mine ? 'you' : shortAddress(offer.maker, 5)}</span>
          {incoming ? (
            <span className="ml-2 chip bg-neon/10 text-neon border border-neon/20 text-[10px]">for you</span>
          ) : offer.taker ? (
            <span className="ml-2 chip bg-flare/10 text-flare border border-flare/20 text-[10px]">private</span>
          ) : null}
        </div>
        <span className={clsx('flex items-center gap-1.5 text-xs font-semibold capitalize', statusTone)}>
          {offer.status === 'open' && <Clock size={12} />}
          {offer.status === 'accepted' && <Check size={12} />}
          {offer.status === 'cancelled' && <X size={12} />}
          {offer.status}
        </span>
      </div>

      <div className="flex items-stretch gap-3">
        {/* From maker's POV: gives -> wants. For a taker, label accordingly. */}
        <SideStack side={offer.give} label={mine ? 'You give' : 'They give'} repByEmblem={repByEmblem} />
        <div className="grid place-items-center px-1">
          <ArrowRight size={18} className="text-slate-500" />
        </div>
        <SideStack side={offer.want} label={mine ? 'You want' : 'You give'} repByEmblem={repByEmblem} />
      </div>

      <div className="mt-4 pt-4 border-t border-[color:var(--border)] flex items-center justify-between">
        <span className="text-xs text-slate-500 flex items-center gap-2">
          {timeAgo(offer.createdAt)}
          {offer.counteredFrom && (
            <span className="chip bg-flare/10 text-flare border border-flare/20 text-[10px]">counter</span>
          )}
        </span>
        <div className="flex gap-2">
          {onCancel && (
            <button onClick={onCancel} className="btn-ghost !py-2 text-xs">
              Cancel
            </button>
          )}
          {onRefuse && offer.status === 'open' && (
            <button
              onClick={onRefuse}
              title="Refuse this swap to hide it from your list. The maker keeps their escrow until they cancel it."
              className="btn-ghost !py-2 text-xs text-flare"
            >
              Refuse
            </button>
          )}
          {onCounter && offer.status === 'open' && (
            <button onClick={onCounter} className="btn-ghost !py-2 text-xs">
              <Repeat2 size={13} /> Counter
            </button>
          )}
          {onAccept && offer.status === 'open' && (
            <button onClick={onAccept} className="btn-primary !py-2 text-xs">
              Accept swap
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
