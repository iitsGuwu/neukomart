import { Link } from 'react-router-dom';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Check, ShoppingCart, Gem } from 'lucide-react';
import { AssetImage, CollectionPill, PriceTag, OriginBadge, FeePill } from './ui';
import { useCart, cartToggle, cartHas } from '../lib/cart';
import { useMarketState } from '../lib/store';
import type { Listing, NeukoAsset } from '../lib/types';

function CartToggle({ listing }: { listing: Listing }) {
  useCart();
  const inCart = cartHas(listing.id);
  return (
    <button
      onClick={() => {
        const added = cartToggle(listing);
        if (!added) toast.error('Cart is full (max 20 items)');
      }}
      title={inCart ? 'Remove from cart' : 'Add to sweep cart'}
      className={clsx(
        'grid h-8 w-8 place-items-center rounded-lg border transition',
        inCart ? 'bg-neon text-[var(--on-accent)] border-neon' : 'btn-ghost !p-0',
      )}
    >
      {inCart ? <Check size={15} strokeWidth={3} /> : <ShoppingCart size={14} />}
    </button>
  );
}

export function MarketCard({
  asset,
  listing,
  onBuy,
}: {
  asset: NeukoAsset;
  listing?: Listing;
  onBuy?: (l: Listing) => void;
}) {
  return (
    <div className="group panel overflow-hidden card-hover">
      <Link to={`/asset/${asset.id}`} className="block relative aspect-square overflow-hidden">
        <AssetImage asset={asset} rounded="rounded-none" className="transition-transform duration-300 group-hover:scale-105" />
        {/* Top-left shows the listing's marketplace source; falls back to the
            collection for unlisted items (which have no source). */}
        <div className="absolute top-3 left-3">
          {listing ? (
            <OriginBadge origin={listing.origin ?? 'neukomart'} compact />
          ) : (
            <CollectionPill collection={asset.collection} compact />
          )}
        </div>
        {!listing && (
          <div className="absolute top-3 right-3 chip bg-ink-950/70 border border-[color:var(--border)] text-slate-400 text-[10px]">
            unlisted
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-950/90 to-transparent" />
      </Link>
      <div className="p-3.5">
        <Link to={`/asset/${asset.id}`} className="font-semibold text-sm truncate block hover:text-neon transition-colors">
          {asset.name}
        </Link>
        {listing ? (
          // Stack price over a full-width action row: on a 2-column mobile card
          // there isn't room for price + cart + Buy side-by-side, so a long
          // amount used to overrun the buttons. Stacking removes any overlap and
          // gives the Buy CTA a clean full-width hit area.
          <div className="mt-2 space-y-2.5">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Price</div>
              <PriceTag amount={listing.price} currency={listing.currency} size="sm" compact />
            </div>
            <div className="flex items-center gap-1.5">
              {/* Sweep cart is native-only: external (ME/Tensor) listings
                  can't be bought atomically in-app, they redirect. */}
              {(!listing.origin || listing.origin === 'neukomart') && <CartToggle listing={listing} />}
              {onBuy && (
                <button onClick={() => onBuy(listing)} className="btn-primary flex-1 !py-2 text-xs">
                  Buy
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between gap-2 min-h-[2.4rem]">
            <span className="text-xs text-slate-500">Not listed</span>
            <Link to={`/asset/${asset.id}`} className="btn-ghost !px-3 !py-1.5 text-xs">
              View
            </Link>
          </div>
        )}
        {/* Fee / origin pill, always shown for listed items */}
        {listing?.origin && (
          <div className="mt-2 pt-2 border-t border-[color:var(--border)]">
            <FeePill origin={listing.origin} />
          </div>
        )}
      </div>
    </div>
  );
}

export function SelectableAssetCard({
  asset,
  selected,
  onToggle,
  disabled,
  lockedLabel,
}: {
  asset: NeukoAsset;
  selected?: boolean;
  onToggle?: (a: NeukoAsset) => void;
  disabled?: boolean;
  /** Overlay text explaining why a card is locked (e.g. "LISTED"). */
  lockedLabel?: string;
}) {
  const market = useMarketState();
  const isDh = !!market.diamondHands?.[asset.id];
  const finalDisabled = disabled || isDh;

  return (
    <button
      type="button"
      disabled={finalDisabled}
      onClick={() => onToggle?.(asset)}
      className={clsx(
        'relative panel overflow-hidden text-left transition-all',
        selected ? 'ring-2 ring-neon shadow-glow' : 'hover:-translate-y-0.5',
        finalDisabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <div className="relative aspect-square overflow-hidden">
        <AssetImage asset={asset} rounded="rounded-none" />
        {selected && (
          <div className="absolute inset-0 bg-neon/15 grid place-items-center">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-neon text-[var(--on-accent)]">
              <Check size={18} strokeWidth={3} />
            </span>
          </div>
        )}
        {isDh && (
          <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center p-2 text-center text-neon font-bold text-[9px] tracking-wider">
            <Gem size={16} className="mb-1" fill="currentColor" />
            DIAMOND HAND
          </div>
        )}
        {!isDh && lockedLabel && (
          <div className="absolute inset-0 bg-black/55 flex items-center justify-center p-2 text-center text-flare font-bold text-[10px] tracking-wider">
            {lockedLabel}
          </div>
        )}
      </div>
      <div className="p-2.5">
        <div className="text-xs font-semibold truncate">{asset.name}</div>
        <div className="text-[10px] text-slate-500 capitalize">{asset.collection}</div>
      </div>
    </button>
  );
}
