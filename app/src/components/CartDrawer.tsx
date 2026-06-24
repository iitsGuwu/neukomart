import { useState } from 'react';
import { X, Trash2, Zap } from 'lucide-react';
import { AssetImage, CurrencyIcon } from './ui';
import { useCart, cartRemove, cartClear, cartTotals } from '../lib/cart';
import { useMarketActions } from '../hooks/useMarketActions';
import { formatAmount } from '../lib/format';

export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cart = useCart();
  const { sweep } = useMarketActions();
  const [busy, setBusy] = useState(false);
  const totals = cartTotals();

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md glass-strong border-l flex flex-col" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <h3 className="font-display text-lg font-bold">Sweep cart ({totals.count})</h3>
          <button onClick={onClose} className="btn-ghost !p-2 !rounded-lg" title="Close">
            <X size={18} />
          </button>
        </div>

        {cart.length === 0 ? (
          <div className="flex-1 grid place-items-center text-slate-400 text-sm p-8 text-center">
            Add listings to the cart to buy several at once in a single transaction.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {cart.map((l) => (
              <div key={l.id} className="flex items-center gap-3 panel p-2.5">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg">
                  <AssetImage asset={l.asset} rounded="rounded-none" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{l.asset.name}</div>
                  <div className="flex items-center gap-1 text-xs text-slate-400">
                    <CurrencyIcon currency={l.currency} size={12} />
                    {formatAmount(l.price, l.currency)} {l.currency.toUpperCase()}
                  </div>
                </div>
                <button onClick={() => cartRemove(l.id)} className="btn-ghost !p-2 !rounded-lg" title="Remove">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        {cart.length > 0 && (
          <div className="p-5 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Total</span>
              <span className="flex items-center gap-3 font-semibold">
                {totals.sol > 0 && (
                  <span className="flex items-center gap-1">
                    <CurrencyIcon currency="sol" size={14} /> {formatAmount(totals.sol, 'sol')}
                  </span>
                )}
                {totals.gboy > 0 && (
                  <span className="flex items-center gap-1">
                    <CurrencyIcon currency="gboy" size={14} /> {formatAmount(totals.gboy, 'gboy')}
                  </span>
                )}
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={cartClear} className="btn-ghost !py-2.5 text-sm">
                Clear
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await sweep(cart);
                  cartClear();
                  setBusy(false);
                  onClose();
                }}
                className="btn-primary flex-1 !py-2.5"
              >
                <Zap size={16} /> {busy ? 'Sweeping…' : `Sweep ${totals.count} item${totals.count > 1 ? 's' : ''}`}
              </button>
            </div>
            <p className="text-xs text-slate-500 text-center">Bought atomically in one transaction.</p>
          </div>
        )}
      </div>
    </div>
  );
}
