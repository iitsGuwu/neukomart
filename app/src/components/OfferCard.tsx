import clsx from 'clsx';
import { ArrowRight, Check, Clock, Repeat2, X } from 'lucide-react';
import { AssetImage, CurrencyIcon } from './ui';
import { shortAddress, timeAgo, formatAmount } from '../lib/format';
import type { SwapOffer, SwapSide } from '../lib/types';

function SideStack({ side, label }: { side: SwapSide; label: string }) {
  const hasMoney = side.sol > 0 || side.gboy > 0;
  return (
    <div className="flex-1 min-w-0">
      <div className="label mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {side.assets.map((a) => (
          <div key={a.id} className="h-12 w-12 overflow-hidden rounded-lg border border-[color:var(--border)]" title={a.name}>
            <AssetImage asset={a} rounded="rounded-none" />
          </div>
        ))}
        {side.assets.length === 0 && !hasMoney && (
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
  onAccept,
  onCancel,
  onCounter,
}: {
  offer: SwapOffer;
  mine?: boolean;
  onAccept?: () => void;
  onCancel?: () => void;
  onCounter?: () => void;
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
          {offer.taker && (
            <span className="ml-2 chip bg-flare/10 text-flare border border-flare/20 text-[10px]">private</span>
          )}
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
        <SideStack side={offer.give} label={mine ? 'You give' : 'They give'} />
        <div className="grid place-items-center px-1">
          <ArrowRight size={18} className="text-slate-500" />
        </div>
        <SideStack side={offer.want} label={mine ? 'You want' : 'You give'} />
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
