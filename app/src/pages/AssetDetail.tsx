import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Repeat2, Tag, ExternalLink, Gavel, Share2 } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import toast from 'react-hot-toast';
import { useHead, ogImageUrl } from '../lib/head';
import { COLLECTIONS } from '../lib/constants';
import { AssetImage, CollectionPill, PriceTag, EcoBadge, CurrencyIcon, OriginBadge, FeePill } from '../components/ui';
import { BuyDialog, ListDialog, MakeOfferDialog } from '../components/dialogs';
import { useMarketState, ownsAsset, denyOffer, undenyOffer } from '../lib/store';
import { useMyAssets, useEcosystemAssets } from '../hooks/useWalletData';
import { useMarketActions } from '../hooks/useMarketActions';
import { shortAddress, formatAmount, timeAgo } from '../lib/format';
import { feeLabel } from '../lib/external-buy';
import type { Listing, NeukoAsset } from '../lib/types';

export function AssetDetail() {
  const { id } = useParams();
  const market = useMarketState();
  const { publicKey } = useWallet();
  const { assets: mine } = useMyAssets();
  const { assets: ecosystem, isLoading } = useEcosystemAssets();
  const { acceptOffer, cancelOffer } = useMarketActions();
  const [buying, setBuying] = useState<Listing | null>(null);
  const [listing, setListing] = useState<NeukoAsset | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);

  const asset = useMemo<NeukoAsset | undefined>(() => {
    const pool: NeukoAsset[] = [
      ...ecosystem,
      ...market.listings.map((l) => l.asset),
      ...mine,
    ];
    return pool.find((a) => a.id === id);
  }, [id, ecosystem, market.listings, mine]);

  const activeListing = market.listings.find((l) => l.asset.id === id);
  const owner = publicKey?.toBase58();
  const owned = !!owner && !!asset && (mine.some((a) => a.id === asset.id) || ownsAsset(asset.id, owner));

  // Offers that apply to this asset: a direct bid, or a collection floor bid.
  // When you own the asset, offers you've denied are hidden from your view.
  const assetOffers = market.offers.filter(
    (o) =>
      o.status === 'open' &&
      !(owned && market.deniedOffers?.[o.id]) &&
      (o.asset === asset?.id || (!o.asset && o.collection === asset?.collection)),
  );

  // Deny = locally dismiss an incoming offer (an owner can't cancel a bidder's
  // escrow on-chain), with an Undo for accidental taps.
  const handleDeny = (offerId: string) => {
    denyOffer(offerId);
    toast((t) => (
      <span className="flex items-center gap-3 text-sm">
        Offer hidden from your inbox
        <button
          onClick={() => {
            undenyOffer(offerId);
            toast.dismiss(t.id);
          }}
          className="font-semibold text-neon hover:underline"
        >
          Undo
        </button>
      </span>
    ));
  };

  useHead({
    title: asset?.name,
    description: asset ? `${asset.name} · ${COLLECTIONS[asset.collection].name} on NEUKO Market. Feeless trading.` : undefined,
    image: asset
      ? ogImageUrl({
          name: asset.name,
          collection: COLLECTIONS[asset.collection].name,
          price: activeListing?.price,
          currency: activeListing?.currency?.toUpperCase(),
          image: asset.image,
        })
      : undefined,
  });

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: asset?.name, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied');
      }
    } catch {
      /* user cancelled */
    }
  };

  if (!asset) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        <p className="text-slate-400">
          {isLoading ? 'Loading asset…' : 'Asset not found in the ecosystem index.'}
        </p>
        {!isLoading && <Link to="/market" className="btn-ghost mt-6">Back to market</Link>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <Link to="/market" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-50 mb-6">
        <ArrowLeft size={15} /> Back
      </Link>

      <div className="grid lg:grid-cols-2 gap-8">
        <div>
          <div className="panel overflow-hidden sticky top-24">
            <div className="aspect-square">
              <AssetImage asset={asset} rounded="rounded-none" />
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <CollectionPill collection={asset.collection} />
            {asset.generative === false && <EcoBadge tone="gboy">on-chain art</EcoBadge>}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold">{asset.name}</h1>
          <div className="mt-2 text-sm text-slate-400 flex items-center gap-2 font-mono">
            {shortAddress(asset.id, 6)}
            <a
              href={`https://solscan.io/token/${asset.id}`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-neon"
              title="View on Solscan"
            >
              <ExternalLink size={13} />
            </a>
            <button onClick={share} className="hover:text-neon" title="Share">
              <Share2 size={13} />
            </button>
          </div>

          {/* price / actions */}
          <div className="panel p-5 mt-6">
            {activeListing ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="label">Current price</div>
                  {activeListing.origin && <OriginBadge origin={activeListing.origin} />}
                </div>
                <div className="mt-1">
                  <PriceTag amount={activeListing.price} currency={activeListing.currency} size="lg" />
                </div>
                {/* Fee + seller-receives breakdown */}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <FeePill origin={activeListing.origin ?? 'neukomart'} />
                  {(activeListing.origin === 'magiceden' || activeListing.origin === 'tensor') && (() => {
                    const { feeAmount, sellerReceives } = feeLabel(activeListing.origin, activeListing.price);
                    return (
                      <span className="text-xs text-slate-500">
                        Seller receives {formatAmount(sellerReceives, activeListing.currency)}{' '}
                        {activeListing.currency.toUpperCase()}
                        {' '}({formatAmount(feeAmount, activeListing.currency)} fee)
                      </span>
                    );
                  })()}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  {owned ? (
                    <span className="chip bg-[var(--soft)] text-slate-400">You own this</span>
                  ) : (
                    <button onClick={() => setBuying(activeListing)} className="btn-primary !px-6 !py-3">
                      Buy now
                    </button>
                  )}
                  {!owned && (
                    <button onClick={() => setOfferOpen(true)} className="btn-ghost !px-5 !py-3">
                      <Gavel size={16} /> Make offer
                    </button>
                  )}
                  <Link to="/swap" className="btn-ghost !px-5 !py-3">
                    <Repeat2 size={16} /> Swap
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="label">Status</div>
                <div className="mt-1 font-display text-lg font-bold text-slate-300">Not listed</div>
                <div className="mt-4 flex flex-wrap gap-3">
                  {owned ? (
                    <button onClick={() => setListing(asset)} className="btn-primary !px-6 !py-3">
                      <Tag size={16} /> List for sale
                    </button>
                  ) : (
                    <button onClick={() => setOfferOpen(true)} className="btn-primary !px-6 !py-3">
                      <Gavel size={16} /> Make offer
                    </button>
                  )}
                  <Link to="/swap" className="btn-ghost !px-5 !py-3">
                    <Repeat2 size={16} /> Swap
                  </Link>
                </div>
              </>
            )}
            <div className="mt-4 pt-4 border-t border-[color:var(--border)] flex items-center gap-2 text-xs text-gboy">
              <EcoBadge tone="gboy">0% fee</EcoBadge>
              <span className="text-slate-500">Seller receives 100% of the price.</span>
            </div>
          </div>

          {/* offers */}
          <div className="mt-6">
            <div className="label mb-3">Offers ({assetOffers.length})</div>
            {assetOffers.length === 0 ? (
              <div className="panel p-4 text-sm text-slate-500">
                No offers yet. {!owned && 'Be the first to make one.'}
              </div>
            ) : (
              <div className="panel divide-y divide-[color:var(--border)]">
                {assetOffers.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-3 p-3.5">
                    <div className="flex items-center gap-2.5">
                      <CurrencyIcon currency={o.currency} size={16} />
                      <div>
                        <div className="font-semibold text-sm tabular-nums">
                          {formatAmount(o.amount, o.currency)} {o.currency.toUpperCase()}
                        </div>
                        <div className="text-xs text-slate-500">
                          {o.asset ? 'item offer' : 'collection bid'} · {shortAddress(o.bidder, 4)} · {timeAgo(o.createdAt)}
                        </div>
                      </div>
                    </div>
                    {owned ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleDeny(o.id)}
                          title="Hide this offer from your inbox. The bidder keeps their escrow until they withdraw it."
                          className="btn-ghost !py-2 text-xs text-flare"
                        >
                          Deny
                        </button>
                        <button onClick={() => acceptOffer(o.id, asset)} className="btn-primary !py-2 text-xs">
                          Accept
                        </button>
                      </div>
                    ) : o.bidder === owner ? (
                      <button onClick={() => cancelOffer(o.id)} className="btn-ghost !py-2 text-xs">
                        Withdraw
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* traits */}
          {asset.attributes.length > 0 && (
            <div className="mt-6">
              <div className="label mb-3">Traits</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {asset.attributes.map((t) => (
                  <div key={t.trait_type} className="rounded-xl bg-ink-900/60 border border-[color:var(--border)] px-3.5 py-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-neon/80">{t.trait_type}</div>
                    <div className="mt-0.5 text-sm font-semibold truncate">{t.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <BuyDialog listing={buying} onClose={() => setBuying(null)} />
      <ListDialog asset={listing} onClose={() => setListing(null)} />
      <MakeOfferDialog
        open={offerOpen}
        onClose={() => setOfferOpen(false)}
        collection={asset.collection}
        asset={asset}
      />
    </div>
  );
}
