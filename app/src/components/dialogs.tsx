import { useState } from 'react';
import clsx from 'clsx';
import { ShieldCheck, Zap, Gavel, ExternalLink } from 'lucide-react';
import { Modal, AssetImage, PriceTag, CurrencyIcon, CollectionPill, OriginBadge, ORIGIN_META, originUrl } from './ui';
import { useBalances } from '../hooks/useWalletData';
import { useMarketActions } from '../hooks/useMarketActions';
import { formatAmount } from '../lib/format';
import { COLLECTIONS, type CollectionKey } from '../lib/constants';
import { feeLabel } from '../lib/external-buy';
import type { Listing, NeukoAsset, Currency } from '../lib/types';

export function BuyDialog({ listing, onClose }: { listing: Listing | null; onClose: () => void }) {
  const { buy } = useMarketActions();
  const { data: bal } = useBalances();
  const [busy, setBusy] = useState(false);
  if (!listing) return null;

  const origin = listing.origin ?? 'neukomart';
  const meta = ORIGIN_META[origin];
  const isExternal = origin === 'magiceden' || origin === 'tensor';
  const externalUrl = isExternal ? originUrl(origin, listing.asset.id) : null;

  // Cost breakdown — buyer pays full price; the marketplace fee and the
  // (universal) creator royalty come out of the seller's proceeds.
  const { feeAmount, royaltyAmount, sellerReceives } = feeLabel(origin, listing.price);
  const cur = listing.currency.toUpperCase();
  const balance = listing.currency === 'sol' ? bal?.sol : bal?.gboy;
  const enough = balance != null ? balance >= listing.price : true;

  return (
    <Modal open={!!listing} onClose={onClose} title="Confirm purchase">
      <div className="flex gap-4">
        <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl">
          <AssetImage asset={listing.asset} />
        </div>
        <div className="min-w-0">
          <CollectionPill collection={listing.asset.collection} />
          <div className="mt-2 font-display text-lg font-bold truncate">{listing.asset.name}</div>
          <div className="mt-1.5 flex items-center gap-2 text-sm text-slate-400">
            <span>by {listing.seller.slice(0, 6)}…</span>
            <OriginBadge origin={origin} />
          </div>
        </div>
      </div>

      {/* Fee breakdown panel */}
      <div className="mt-5 space-y-2.5 rounded-2xl bg-ink-900/60 border border-[color:var(--border)] p-4">
        <Row label="You pay" value={<PriceTag amount={listing.price} currency={listing.currency} size="sm" />} />
        <Row
          label="Marketplace fee"
          value={
            meta.fee === 0 ? (
              <span className="text-green-400 font-semibold flex items-center gap-1">
                <Zap size={12} /> 0% · feeless
              </span>
            ) : (
              <span className="font-semibold" style={{ color: meta.color }}>
                {meta.feeLabel} · {formatAmount(feeAmount, listing.currency)} {cur}
              </span>
            )
          }
        />
        <Row
          label={<>Creator royalty <span className="text-slate-500 font-normal">· all marketplaces</span></>}
          value={
            <span className="font-semibold text-slate-200">
              5% · {formatAmount(royaltyAmount, listing.currency)} {cur}
            </span>
          }
        />
        <Row
          label="Seller receives"
          value={
            <span className="font-semibold text-slate-200">
              {formatAmount(sellerReceives, listing.currency)} {cur}
            </span>
          }
        />
        <Row
          label="Source"
          value={<span className="font-semibold" style={{ color: meta.color }}>{meta.label}</span>}
        />
      </div>

      {/* Balance check */}
      {balance != null && (
        <div className={clsx('mt-3 text-sm flex items-center gap-2', enough ? 'text-slate-400' : 'text-flare')}>
          <CurrencyIcon currency={listing.currency} size={14} />
          Balance: {formatAmount(balance, listing.currency)} {listing.currency.toUpperCase()}
          {!enough && ' · insufficient'}
        </div>
      )}

      {/* Primary action */}
      <button
        disabled={busy || (!isExternal && !enough)}

        onClick={async () => {
          if (isExternal && externalUrl) {
            window.open(externalUrl, '_blank');
            onClose();
            return;
          }
          setBusy(true);
          await buy(listing);
          setBusy(false);
          onClose();
        }}
        className="btn-primary w-full mt-4 !py-3"
        style={isExternal ? { background: meta.color, borderColor: meta.color } : undefined}
      >
        {busy ? (
          'Processing…'
        ) : isExternal ? (
          <><ExternalLink size={16} /> View on {meta.label}</>
        ) : (
          <>
            <Zap size={16} />
            {`Buy for ${formatAmount(listing.price, listing.currency)} ${listing.currency.toUpperCase()}`}
          </>
        )}
      </button>

      {/* Footer note */}
      {isExternal ? (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>Complete your purchase on {meta.label} · {meta.feeLabel}</span>
          {externalUrl && (
            <a
              href={externalUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 hover:text-slate-300 transition-colors ml-2 shrink-0"
              title={`Open on ${meta.label}`}
            >
              <ExternalLink size={11} /> {meta.short}
            </a>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500 flex items-center gap-1.5 justify-center">
          <ShieldCheck size={13} /> Non-custodial · atomic settlement on Solana
        </p>
      )}
    </Modal>
  );
}


export function ListDialog({ asset, onClose }: { asset: NeukoAsset | null; onClose: () => void }) {
  const { list } = useMarketActions();
  const [currency, setCurrency] = useState<Currency>('sol');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  if (!asset) return null;

  const num = parseFloat(price);
  const valid = !isNaN(num) && num > 0;

  return (
    <Modal open={!!asset} onClose={onClose} title="List for sale">
      <div className="flex gap-4">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl">
          <AssetImage asset={asset} />
        </div>
        <div>
          <CollectionPill collection={asset.collection} />
          <div className="mt-2 font-display text-lg font-bold">{asset.name}</div>
        </div>
      </div>

      <div className="mt-5">
        <div className="label mb-2">Currency</div>
        <div className="grid grid-cols-2 gap-2">
          {(['sol', 'gboy'] as Currency[]).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={clsx(
                'flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold transition',
                currency === c
                  ? 'border-neon/50 bg-neon/10 text-slate-50'
                  : 'border-[color:var(--border)] text-slate-400 hover:bg-[var(--hover)]',
              )}
            >
              <CurrencyIcon currency={c} size={16} />
              {c === 'sol' ? 'SOL' : '$GBOY'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="label mb-2">Price</div>
        <div className="relative">
          <input
            autoFocus
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            placeholder="0.00"
            className="input !pr-20 !text-lg tabular-nums"
          />
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
            {currency === 'sol' ? 'SOL' : '$GBOY'}
          </span>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-gboy/5 border border-gboy/20 px-3.5 py-2.5 text-xs text-gboy flex items-start gap-2">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
        <span>
          <b>Escrowless</b>: the NFT stays in your wallet (frozen) until it sells. 0% marketplace fees. The 5% creator royalty is set by the collection and applies on every marketplace, not just here.
        </span>
      </div>

      <button
        disabled={!valid || busy}
        onClick={async () => {
          setBusy(true);
          await list(asset, num, currency);
          setBusy(false);
          onClose();
        }}
        className="btn-primary w-full mt-5 !py-3"
      >
        {busy ? 'Listing…' : 'Confirm listing'}
      </button>
    </Modal>
  );
}

export function MakeOfferDialog({
  open,
  onClose,
  collection,
  asset,
}: {
  open: boolean;
  onClose: () => void;
  collection: CollectionKey;
  asset?: NeukoAsset; // omit for a collection floor bid
}) {
  const { makeOffer } = useMarketActions();
  const { data: bal } = useBalances();
  const [currency, setCurrency] = useState<Currency>('sol');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const num = parseFloat(amount);
  const valid = !isNaN(num) && num > 0;
  const balance = currency === 'sol' ? bal?.sol : bal?.gboy;
  const enough = balance != null ? balance >= num : true;

  return (
    <Modal open={open} onClose={onClose} title={asset ? 'Make an offer' : `Floor bid · ${COLLECTIONS[collection].name}`}>
      <div className="flex gap-4">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl">
          {asset ? (
            <AssetImage asset={asset} />
          ) : (
            <img src={COLLECTIONS[collection].cover} alt="" className="h-full w-full object-cover bg-ink-800" />
          )}
        </div>
        <div>
          <CollectionPill collection={collection} />
          <div className="mt-2 font-display text-lg font-bold">{asset ? asset.name : COLLECTIONS[collection].name}</div>
          <div className="text-sm text-slate-400">
            {asset ? 'Offer on this item' : 'Any holder in the collection can accept'}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="label mb-2">Offer with</div>
        <div className="grid grid-cols-2 gap-2">
          {(['sol', 'gboy'] as Currency[]).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={clsx(
                'flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold transition',
                currency === c ? 'border-neon/50 bg-neon/10 text-slate-50' : 'border-[color:var(--border)] text-slate-400 hover:bg-[var(--hover)]',
              )}
            >
              <CurrencyIcon currency={c} size={16} />
              {c === 'sol' ? 'SOL' : '$GBOY'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="label mb-2">Amount (escrowed until accepted or withdrawn)</div>
        <div className="relative">
          <input
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            placeholder="0.00"
            className="input !pr-20 !text-lg tabular-nums"
          />
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
            {currency === 'sol' ? 'SOL' : '$GBOY'}
          </span>
        </div>
        {balance != null && (
          <div className={clsx('mt-2 text-xs', enough ? 'text-slate-500' : 'text-flare')}>
            Balance: {formatAmount(balance, currency)} {currency.toUpperCase()}
            {!enough && ' · insufficient'}
          </div>
        )}
      </div>

      <button
        disabled={!valid || !enough || busy}
        onClick={async () => {
          setBusy(true);
          await makeOffer(collection, num, currency, asset);
          setBusy(false);
          onClose();
        }}
        className="btn-primary w-full mt-5 !py-3"
      >
        <Gavel size={16} />
        {busy ? 'Placing…' : 'Place offer'}
      </button>
    </Modal>
  );
}

function Row({ label, value, strong }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={strong ? 'font-semibold' : 'text-slate-400'}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
