import { useEffect, useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { X, Zap } from 'lucide-react';
import { COLLECTIONS, type CollectionKey } from '../lib/constants';
import { harmieArt, badgeArt } from '../lib/art';
import { formatAmount, currencyLabel } from '../lib/format';
import type { Currency, NeukoAsset, MarketOrigin } from '../lib/types';

export function NeukoLogo({ className }: { className?: string }) {
  return (
    <Link to="/" className={clsx('flex items-center gap-2.5 group', className)}>
      <img
        src="/logo.jpg"
        alt="neukomart"
        className="h-9 w-9 rounded-xl border shadow-glow object-cover"
        style={{ borderColor: 'var(--border-strong)' }}
      />
      <span className="font-display text-[18px] font-bold tracking-tight lowercase">
        neuko<span className="text-neon">mart</span>
      </span>
    </Link>
  );
}

/** Currency icon — SOL or $GBOY coin. */
export function CurrencyIcon({ currency, size = 16 }: { currency: Currency; size?: number }) {
  // Unique gradient id per instance — a shared id breaks when the defining
  // instance unmounts (filtering/scroll), which made SOL icons disappear.
  const gid = `sol-${useId()}`;
  if (currency === 'sol') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="inline-block align-middle shrink-0">
        <defs>
          <linearGradient id={gid} x1="2" y1="20" x2="22" y2="4" gradientUnits="userSpaceOnUse">
            <stop stopColor="#9945FF" />
            <stop offset="1" stopColor="#14F195" />
          </linearGradient>
        </defs>
        <path d="M5 7.5h12.5L15 10H2.5L5 7.5Z" fill={`url(#${gid})`} />
        <path d="M5 11.2h12.5L15 13.7H2.5L5 11.2Z" fill={`url(#${gid})`} />
        <path d="M5 15h12.5L15 17.5H2.5L5 15Z" fill={`url(#${gid})`} />
      </svg>
    );
  }
  return (
    <img
      src="/gboy.svg"
      alt="$GBOY"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="rounded-full object-cover inline-block align-middle shrink-0"
    />
  );
}

export function PriceTag({
  amount,
  currency,
  size = 'md',
  className,
}: {
  amount: number;
  currency: Currency;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const txt = size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-sm' : 'text-base';
  return (
    <span className={clsx('inline-flex items-center gap-1.5 font-semibold min-w-0', txt, className)}>
      <CurrencyIcon currency={currency} size={size === 'lg' ? 20 : 15} />
      <span className="tabular-nums truncate">{formatAmount(amount, currency)}</span>
      <span className="text-slate-400 font-medium text-[0.82em] shrink-0">{currencyLabel(currency)}</span>
    </span>
  );
}

export function CollectionPill({ collection, className }: { collection: CollectionKey; className?: string }) {
  const meta = COLLECTIONS[collection];
  const tone =
    collection === 'harmies'
      ? 'bg-harm/15 text-harm border-harm/30'
      : 'bg-neon/15 text-neon border-neon/30';
  return (
    <span className={clsx('chip border', tone, className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {meta.name}
    </span>
  );
}

/** Asset artwork with a guaranteed on-brand fallback. */
export function AssetImage({
  asset,
  className,
  rounded = 'rounded-2xl',
}: {
  asset: NeukoAsset;
  className?: string;
  rounded?: string;
}) {
  const fallback = asset.collection === 'harmies' ? harmieArt(asset.id) : badgeArt(asset.id);
  return (
    <img
      src={asset.image || fallback}
      alt={asset.name}
      loading="lazy"
      onError={(e) => {
        const el = e.currentTarget;
        if (el.src !== fallback) el.src = fallback;
      }}
      className={clsx('w-full h-full object-cover bg-ink-800', rounded, className)}
    />
  );
}

export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="panel px-4 py-3">
      <div className="label">{label}</div>
      <div className={clsx('mt-1 font-display text-lg font-bold', accent)}>{value}</div>
    </div>
  );
}

export const ORIGIN_META: Record<
  MarketOrigin,
  { label: string; short: string; color: string; fee: number; feeLabel: string }
> = {
  magiceden: { label: 'Magic Eden', short: 'Magic Eden', color: '#e42575', fee: 0.02,  feeLabel: '2% fee'      },
  tensor:    { label: 'Tensor',     short: 'Tensor',     color: '#5c7cfa', fee: 0.015, feeLabel: '1.5% fee'    },
  neukomart: { label: 'neukomart',  short: 'neuko',      color: '#ff2222', fee: 0,     feeLabel: '0% feeless'  },
};

/** Link to the item's page on its source marketplace (null for neukomart). */
export function originUrl(origin: MarketOrigin | undefined, mint: string): string | null {
  if (origin === 'magiceden') return `https://magiceden.io/item-details/${mint}`;
  if (origin === 'tensor') return `https://www.tensor.trade/item/${mint}`;
  return null;
}

/** Small chip showing which marketplace a listing comes from. */
export function OriginBadge({ origin, compact = false, className }: { origin: MarketOrigin; compact?: boolean; className?: string }) {
  const m = ORIGIN_META[origin] ?? ORIGIN_META.neukomart;
  return (
    <span
      className={clsx('chip border text-[10px] font-semibold', className)}
      title={`Listed on ${m.label}`}
      style={{ color: m.color, borderColor: `${m.color}55`, backgroundColor: `${m.color}1f` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: m.color }} />
      {compact ? m.short : m.label}
    </span>
  );
}

/**
 * Origin + fee pill for use on NFT cards.
 * NEUKO listings show a green feeless badge; ME/Tensor show their fee.
 */
export function FeePill({ origin, className }: { origin: MarketOrigin; className?: string }) {
  const m = ORIGIN_META[origin] ?? ORIGIN_META.neukomart;
  const isNeuko = origin === 'neukomart';
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide border',
        className,
      )}
      style={{
        color:           isNeuko ? '#22c55e' : m.color,
        borderColor:     isNeuko ? '#22c55e55' : `${m.color}55`,
        backgroundColor: isNeuko ? '#22c55e18' : `${m.color}18`,
      }}
      title={`${m.label} · ${m.feeLabel}`}
    >
      {isNeuko ? (
        <Zap size={8} className="shrink-0" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
      )}
      {isNeuko ? '0% FEELESS' : `${m.feeLabel.toUpperCase()} · ${m.short.toUpperCase()}`}
    </span>
  );
}

export function EcoBadge({ children, tone = 'neon' }: { children: ReactNode; tone?: 'neon' | 'gboy' | 'harm' }) {
  const tones = {
    neon: 'bg-neon/10 text-neon border-neon/25',
    gboy: 'bg-gboy/10 text-gboy border-gboy/25',
    harm: 'bg-harm/10 text-harm border-harm/25',
  };
  return <span className={clsx('chip border', tones[tone])}>{children}</span>;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[fadeIn_.15s_ease]" onClick={onClose} />
      <div className={clsx('relative w-full glass-strong rounded-3xl shadow-card p-6', maxWidth)}>
        <div className="flex items-start justify-between mb-5">
          <h3 className="font-display text-xl font-bold text-balance">{title}</h3>
          <button onClick={onClose} className="btn-ghost !p-2 !rounded-lg">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SectionTitle({ kicker, title, subtitle }: { kicker?: string; title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-6">
      {kicker && <div className="label text-neon mb-1.5">{kicker}</div>}
      <h2 className="font-display text-2xl sm:text-3xl font-bold text-balance">{title}</h2>
      {subtitle && <p className="mt-2 text-slate-400 max-w-2xl">{subtitle}</p>}
    </div>
  );
}
