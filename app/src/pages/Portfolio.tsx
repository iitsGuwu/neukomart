import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import clsx from 'clsx';
import { Tag, Wallet, Sparkles, Gavel, Gem } from 'lucide-react';
import { AssetImage, CollectionPill, PriceTag, CurrencyIcon, SectionTitle, EcoBadge, Modal } from '../components/ui';
import { ListDialog } from '../components/dialogs';
import { useBalances, useMyAssets } from '../hooks/useWalletData';
import { useMarketActions } from '../hooks/useMarketActions';
import { useMarketState, toggleDiamondHand } from '../lib/store';
import { formatAmount, shortAddress, timeAgo } from '../lib/format';
import type { NeukoAsset } from '../lib/types';

export function Portfolio() {
  const { connected, publicKey } = useWallet();
  const { data: bal } = useBalances();
  const { assets, live, isLoading } = useMyAssets();
  const market = useMarketState();
  const { cancelList, acceptOffer, cancelOffer } = useMarketActions();
  const [listing, setListing] = useState<NeukoAsset | null>(null);
  const [dhAssetToToggle, setDhAssetToToggle] = useState<string | null>(null);

  const me = publicKey?.toBase58();
  const myListings = market.listings.filter((l) => l.seller === me);
  const listedIds = new Set(myListings.map((l) => l.asset.id));

  const myAssetIds = new Set(assets.map((a) => a.id));
  const myCollections = new Set(assets.map((a) => a.collection));
  const madeOffers = market.offers.filter((o) => o.status === 'open' && o.bidder === me);
  // Offers I can fill: a direct bid on an asset I hold, or a floor bid on a collection I hold.
  const receivedOffers = market.offers.filter(
    (o) =>
      o.status === 'open' &&
      o.bidder !== me &&
      ((o.asset && myAssetIds.has(o.asset)) || (!o.asset && myCollections.has(o.collection))),
  );
  const fillAssetFor = (o: (typeof market.offers)[number]): NeukoAsset | undefined =>
    o.asset ? assets.find((a) => a.id === o.asset) : assets.find((a) => a.collection === o.collection);

  if (!connected) {
    return (
      <div className="mx-auto max-w-xl px-4 py-28 text-center">
        <div className="grid h-16 w-16 mx-auto place-items-center rounded-2xl bg-ink-800 border border-neon/30 shadow-glow">
          <Wallet className="text-neon" />
        </div>
        <h2 className="mt-6 font-display text-2xl font-bold">Connect your wallet</h2>
        <p className="mt-2 text-slate-400">See your Badges, Harmies and $GBOY, then list or swap in a click.</p>
        <div className="mt-6 flex justify-center">
          <WalletMultiButton />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <SectionTitle kicker="Portfolio" title="Your ecosystem holdings" />

      {/* holdings summary */}
      <div className="grid sm:grid-cols-3 gap-3 mb-8">
        <div className="panel p-5">
          <div className="flex items-center gap-2 label"><CurrencyIcon currency="gboy" size={14} /> $GBOY</div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums">{bal ? formatAmount(bal.gboy, 'gboy') : '—'}</div>
        </div>
        <div className="panel p-5">
          <div className="flex items-center gap-2 label"><span className="h-2 w-2 rounded-full bg-neon" /> Badges</div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums">
            {assets.filter((a) => a.collection === 'badges').length}
          </div>
        </div>
        <div className="panel p-5">
          <div className="flex items-center gap-2 label"><span className="h-2 w-2 rounded-full bg-harm" /> Harmies</div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums">
            {assets.filter((a) => a.collection === 'harmies').length}
          </div>
        </div>
      </div>

      {!live && (
        <div className="mb-6 rounded-xl bg-neon/[0.06] border border-neon/20 px-4 py-3 text-sm text-slate-300 flex items-center gap-2">
          <Sparkles size={15} className="text-neon" />
          Showing a demo inventory. Add a DAS-enabled RPC (<code className="font-mono text-xs">VITE_RPC_URL</code>) to index your real on-chain holdings.
        </div>
      )}

      {/* my listings */}
      {myListings.length > 0 && (
        <section className="mb-10">
          <h3 className="font-display text-lg font-bold mb-4">Your active listings</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {myListings.map((l) => (
              <div key={l.id} className="panel overflow-hidden">
                <Link to={`/asset/${l.asset.id}`} className="block aspect-square overflow-hidden">
                  <AssetImage asset={l.asset} rounded="rounded-none" />
                </Link>
                <div className="p-3">
                  <div className="text-sm font-semibold truncate">{l.asset.name}</div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <PriceTag amount={l.price} currency={l.currency} size="sm" />
                    <button onClick={() => cancelList(l.asset.id)} className="text-xs text-flare hover:underline">
                      Delist
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* offers */}
      {(receivedOffers.length > 0 || madeOffers.length > 0) && (
        <section className="mb-10 grid lg:grid-cols-2 gap-5">
          <div>
            <h3 className="font-display text-lg font-bold mb-4 flex items-center gap-2">
              <Gavel size={16} className="text-neon" /> Offers on your items ({receivedOffers.length})
            </h3>
            {receivedOffers.length === 0 ? (
              <div className="panel p-5 text-sm text-slate-500">No incoming offers.</div>
            ) : (
              <div className="panel divide-y divide-[color:var(--border)]">
                {receivedOffers.map((o) => {
                  const fill = fillAssetFor(o);
                  return (
                    <div key={o.id} className="flex items-center justify-between gap-3 p-3.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <CurrencyIcon currency={o.currency} size={16} />
                        <div className="min-w-0">
                          <div className="font-semibold text-sm tabular-nums">
                            {formatAmount(o.amount, o.currency)} {o.currency.toUpperCase()}
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            {o.asset ? o.assetName ?? 'item' : `${o.collection} floor`} · {shortAddress(o.bidder, 4)}
                          </div>
                        </div>
                      </div>
                      {fill && (
                        <button onClick={() => acceptOffer(o.id, fill)} className="btn-primary !py-2 text-xs shrink-0">
                          Accept
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h3 className="font-display text-lg font-bold mb-4">Offers you&apos;ve made ({madeOffers.length})</h3>
            {madeOffers.length === 0 ? (
              <div className="panel p-5 text-sm text-slate-500">You haven&apos;t made any offers.</div>
            ) : (
              <div className="panel divide-y divide-[color:var(--border)]">
                {madeOffers.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-3 p-3.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CurrencyIcon currency={o.currency} size={16} />
                      <div className="min-w-0">
                        <div className="font-semibold text-sm tabular-nums">
                          {formatAmount(o.amount, o.currency)} {o.currency.toUpperCase()}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {o.asset ? o.assetName ?? 'item offer' : `${o.collection} floor bid`} · {timeAgo(o.createdAt)}
                        </div>
                      </div>
                    </div>
                    <button onClick={() => cancelOffer(o.id)} className="btn-ghost !py-2 text-xs shrink-0">
                      Withdraw
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* holdings */}
      <h3 className="font-display text-lg font-bold mb-4">Items</h3>
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="panel aspect-[3/4] animate-pulse bg-ink-800/50" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <div className="panel p-16 text-center text-slate-400">
          No Badges or Harmies found in this wallet.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {assets.map((a) => {
            const isDh = !!market.diamondHands?.[a.id];
            return (
              <div key={a.id} className="group panel overflow-hidden card-hover">
                <Link to={`/asset/${a.id}`} className="block relative aspect-square overflow-hidden">
                  <AssetImage asset={a} rounded="rounded-none" className="group-hover:scale-105 transition-transform" />
                  <div className="absolute top-2 left-2">
                    <CollectionPill collection={a.collection} />
                  </div>
                  {isDh && (
                    <div className="absolute top-2 right-2 chip border-neon/50 bg-neon/15 text-neon text-[9px] font-bold flex items-center gap-1 py-0.5 px-1.5 rounded-full">
                      <Gem size={9} fill="currentColor" /> DH
                    </div>
                  )}
                </Link>
                <div className="p-3">
                  <div className="text-sm font-semibold truncate">{a.name}</div>
                  <div className="mt-2 flex gap-1.5">
                    {listedIds.has(a.id) ? (
                      <div className="flex-1 flex justify-center items-center">
                        <EcoBadge tone="gboy">Listed</EcoBadge>
                      </div>
                    ) : (
                      <button onClick={() => setListing(a)} className="btn-ghost flex-1 !py-1.5 text-xs">
                        <Tag size={13} /> List
                      </button>
                    )}
                    <button
                      onClick={() => setDhAssetToToggle(a.id)}
                      title={isDh ? "Remove Diamond Hand status" : "Diamond Hand this item (prevents swap requests)"}
                      className={clsx(
                        "btn-ghost !p-2 !rounded-lg shrink-0 border",
                        isDh ? "text-neon bg-neon/10 border-neon/30" : "text-slate-400 border-transparent hover:border-[color:var(--border)]"
                      )}
                    >
                      <Gem size={13} fill={isDh ? "currentColor" : "none"} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ListDialog asset={listing} onClose={() => setListing(null)} />

      <Modal
        open={!!dhAssetToToggle}
        onClose={() => setDhAssetToToggle(null)}
        title={dhAssetToToggle && market.diamondHands?.[dhAssetToToggle] ? "Disable Diamond Hand" : "Enable Diamond Hand"}
      >
        <div className="space-y-4">
          {dhAssetToToggle && market.diamondHands?.[dhAssetToToggle] ? (
            <>
              <p className="text-slate-300 text-sm leading-relaxed">
                You are about to remove <b>Diamond Hand</b> status from this item.
              </p>
              <ul className="text-slate-400 text-xs list-disc list-inside space-y-1.5 pl-2">
                <li>This item will become public again.</li>
                <li>Other users will be able to request it in <b>Swap Offers</b>.</li>
              </ul>
            </>
          ) : (
            <>
              <p className="text-slate-300 text-sm leading-relaxed">
                By enabling <b>Diamond Hand</b> status on this item:
              </p>
              <ul className="text-slate-400 text-xs list-disc list-inside space-y-2 pl-2">
                <li>It will be automatically <b>delisted</b> from the marketplace.</li>
                <li>Other users will be <b>prevented</b> from requesting it in swaps.</li>
                <li>You can disable this status at any time to resume trading.</li>
              </ul>
            </>
          )}

          <div className="flex gap-3 mt-6 pt-2">
            <button
              onClick={() => setDhAssetToToggle(null)}
              className="btn-ghost flex-1 !py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (dhAssetToToggle) {
                  const alreadyDh = market.diamondHands?.[dhAssetToToggle];
                  if (!alreadyDh && listedIds.has(dhAssetToToggle)) {
                    cancelList(dhAssetToToggle);
                  }
                  toggleDiamondHand(dhAssetToToggle);
                  setDhAssetToToggle(null);
                }
              }}
              className="btn-primary flex-1 !py-2.5 text-sm"
            >
              Confirm
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
