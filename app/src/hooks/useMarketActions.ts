import { useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import toast from 'react-hot-toast';
import { GBOY_MINT, GBOY_DECIMALS, COLLECTIONS, type CollectionKey } from '../lib/constants';
import { getConnection } from '../lib/chain';
import { sendSmart } from '../lib/tx';
import {
  buildMeBuyTx,
  buildTensorBuyTx,
  ExternalBuyNotConfigured,
} from '../lib/external-buy';
import { originUrl } from '../components/ui';
import { useProgramStatus } from './useWalletData';
import * as store from '../lib/store';
import * as prog from '../lib/program';
import type { Listing, NeukoAsset, SwapSide, Currency } from '../lib/types';

/**
 * Feature flag: set to true once ME_API_KEY + TENSOR_API_KEY are configured in
 * Vercel env to activate native in-app execution of ME / Tensor listings.
 * When false, external listings redirect to the originating marketplace.
 */
const NATIVE_EXTERNAL_BUY = false;

/** Max valid SOL amount before lamport overflow (rough practical limit). */
const MAX_SOL = 1_000_000;
/** Max valid $GBOY amount (10 decimals). */
const MAX_GBOY = 1_000_000_000;

function validatePrice(price: number, currency: Currency): boolean {
  if (!Number.isFinite(price) || price <= 0) return false;
  return currency === 'sol' ? price < MAX_SOL : price < MAX_GBOY;
}

/** Returns true when a real on-chain tx path is available. */
export function useCanTransact() {
  const { connected } = useWallet();
  const { data: deployed } = useProgramStatus();
  return { live: !!connected && !!deployed, deployed: !!deployed };
}

export function useMarketActions() {
  const wallet = useWallet();
  const { live } = useCanTransact();
  const owner = wallet.publicKey?.toBase58();
  const market = store.useMarketState();

  const guard = useCallback(() => {
    if (!owner) {
      toast.error('Connect a wallet first');
      return false;
    }
    return true;
  }, [owner]);

  const buy = useCallback(
    async (listing: Listing) => {
      if (!guard()) return;

      // ── External listings (ME / Tensor) ────────────────────────────────────
      if (listing.origin === 'magiceden' || listing.origin === 'tensor') {
        if (!validatePrice(listing.price, 'sol')) {
          toast.error('Invalid listing price — transaction aborted');
          return;
        }

        if (NATIVE_EXTERNAL_BUY) {
          // Native in-app path — requires ME_API_KEY / TENSOR_API_KEY in Vercel env.
          try {
            const conn = getConnection();
            const buildTx = listing.origin === 'magiceden' ? buildMeBuyTx : buildTensorBuyTx;
            const tx = await toast.promise(
              buildTx(wallet.publicKey!, listing, conn),
              {
                loading: 'Building transaction…',
                success: 'Ready to sign',
                error: (e) => (e instanceof ExternalBuyNotConfigured ? 'Opening external…' : `Failed: ${e.message ?? e}`),
              },
            );
            const { blockhash } = await conn.getLatestBlockhash('confirmed');
            tx.message.recentBlockhash = blockhash;
            await toast.promise(
              wallet.sendTransaction(tx, conn),
              {
                loading: 'Confirming purchase…',
                success: `Purchased ${listing.asset.name}!`,
                error: (e) => `Failed: ${e.message ?? e}`,
              },
            );
          } catch (e) {
            if (e instanceof ExternalBuyNotConfigured) {
              const url = originUrl(listing.origin, listing.asset.id);
              if (url) window.open(url, '_blank', 'noopener,noreferrer');
            }
          }
        } else {
          // Redirect path — opens the listing on the originating marketplace.
          const url = originUrl(listing.origin, listing.asset.id);
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      // ── NEUKO-native listings ───────────────────────────────────────────────
      if (live) {
        try {
          // Reject malformed prices before sending any transaction.
          if (!validatePrice(listing.price, listing.currency)) {
            toast.error('Invalid listing price — transaction aborted');
            return;
          }
          const common = {
            buyer: wallet.publicKey!,
            seller: new PublicKey(listing.seller),
            asset: new PublicKey(listing.asset.id),
            collection: listing.asset.collection,
            maxPrice: BigInt(Math.ceil(listing.price * (listing.currency === 'sol' ? 1e9 : 10 ** GBOY_DECIMALS) * 1.01)),
          };
          const ixs = [];
          if (listing.currency === 'gboy') {
            const { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } =
              await import('@solana/spl-token');
            const sellerAta = getAssociatedTokenAddressSync(GBOY_MINT, common.seller);
            const creator = COLLECTIONS[common.collection].creator;
            const creatorAta = getAssociatedTokenAddressSync(GBOY_MINT, creator, true);
            ixs.push(
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey!,
                sellerAta,
                common.seller,
                GBOY_MINT,
              ),
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey!,
                creatorAta,
                creator,
                GBOY_MINT,
              ),
            );
          }
          ixs.push(
            listing.currency === 'sol'
              ? prog.buildPurchaseSolIx(common)
              : prog.buildPurchaseGboyIx(common),
          );
          await toast.promise(sendSmart(wallet, ixs), {
            loading: 'Confirming purchase…',
            success: 'Purchased!',
            error: (e) => `Failed: ${e.message ?? e}`,
          });
        } catch {
          /* handled by toast */
        }
        return;
      }
      toast.error('Purchase not available — NEUKO program not detected on this network');
    },
    [guard, live, wallet],
  );

  const list = useCallback(
    async (asset: NeukoAsset, price: number, currency: Currency) => {
      if (!guard()) return;
      if (live) {
        try {
          if (!validatePrice(price, currency)) {
            toast.error('Invalid price amount');
            return;
          }
          const priceBase = currency === 'sol' ? prog.solToLamports(price) : prog.gboyToBase(price);
          const ix = prog.buildListIx({
            seller: wallet.publicKey!,
            asset: new PublicKey(asset.id),
            collection: asset.collection,
            price: priceBase,
            currency,
          });
          await toast.promise(sendSmart(wallet, [ix]), {
            loading: 'Listing NFT on-chain…',
            success: 'Listed!',
            error: (e) => `Failed: ${e.message ?? e}`,
          });
        } catch {
          /* handled by toast */
        }
        return;
      }
      toast.error('Listing not available — NEUKO program not detected on this network');
    },
    [guard, live, wallet],
  );

  const cancelList = useCallback(
    async (assetId: string) => {
      if (!guard()) return;
      if (live) {
        try {
          const listing = market.listings.find((l) => l.asset.id === assetId);
          if (!listing) {
            toast.error('Listing not found');
            return;
          }
          const ix = prog.buildCancelListingIx({
            seller: wallet.publicKey!,
            asset: new PublicKey(assetId),
            collection: listing.asset.collection,
          });
          await toast.promise(sendSmart(wallet, [ix]), {
            loading: 'Delisting NFT on-chain…',
            success: 'Listing cancelled!',
            error: (e) => `Failed: ${e.message ?? e}`,
          });
        } catch {
          /* handled by toast */
        }
        return;
      }
      toast.error('Delisting not available — NEUKO program not detected on this network');
    },
    [guard, live, market.listings, wallet],
  );

  const createSwap = useCallback(
    async (give: SwapSide, want: SwapSide, taker?: string, counteredFrom?: string) => {
      if (!guard()) return;
      toast.error('Swaps are currently disabled');
    },
    [guard],
  );

  const acceptSwap = useCallback(
    async (swapId: string) => {
      if (!guard()) return;
      toast.error('Swaps are currently disabled');
    },
    [guard],
  );

  const cancelSwap = useCallback(
    async (swapId: string) => {
      if (!guard()) return;
      toast.error('Swaps are currently disabled');
    },
    [guard],
  );

  const makeOffer = useCallback(
    async (collection: CollectionKey, amount: number, currency: Currency, target?: NeukoAsset) => {
      if (!guard()) return;
      if (live) {
        try {
          if (!validatePrice(amount, currency)) {
            toast.error('Invalid price amount');
            return;
          }
          const amountBase = currency === 'sol' ? prog.solToLamports(amount) : prog.gboyToBase(amount);
          const nonce = BigInt(Date.now());
          const [offer] = prog.offerPda(wallet.publicKey!, nonce);
          const ixs = [];

          if (currency === 'gboy') {
            const { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } =
              await import('@solana/spl-token');
            const offerGboy = getAssociatedTokenAddressSync(GBOY_MINT, offer, true);
            ixs.push(
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey!,
                offerGboy,
                offer,
                GBOY_MINT,
              )
            );
          }

          ixs.push(prog.buildCreateOfferIx({
            bidder: wallet.publicKey!,
            nonce,
            collection,
            asset: target ? new PublicKey(target.id) : null,
            amount: amountBase,
            currency,
          }));

          await toast.promise(sendSmart(wallet, ixs), {
            loading: 'Creating offer on-chain…',
            success: 'Offer created!',
            error: (e) => `Failed: ${e.message ?? e}`,
          });
        } catch {
          /* handled by toast */
        }
        return;
      }
      toast.error('Offers not available — NEUKO program not detected on this network');
    },
    [guard, live, wallet],
  );

  const cancelOffer = useCallback(
    async (offerId: string) => {
      if (!guard()) return;
      if (live) {
        try {
          const conn = getConnection();
          const info = await conn.getAccountInfo(new PublicKey(offerId));
          if (!info) {
            toast.error('Offer account not found on-chain');
            return;
          }
          // Read nonce at offset 113 (8 bytes u64 LE)
          const nonce = info.data.readBigUInt64LE(113);
          // Read currency at offset 112 (1 byte u8: 0 = SOL, 1 = GBOY)
          const currencyCode = info.data[112];
          const currency: Currency = currencyCode === 1 ? 'gboy' : 'sol';

          const ix = prog.buildCancelOfferIx({
            bidder: wallet.publicKey!,
            nonce,
            currency,
          });

          await toast.promise(sendSmart(wallet, [ix]), {
            loading: 'Withdrawing offer from on-chain…',
            success: 'Offer withdrawn!',
            error: (e) => `Failed: ${e.message ?? e}`,
          });
        } catch {
          /* handled by toast */
        }
        return;
      }
      toast.error('Cancellation not available — NEUKO program not detected on this network');
    },
    [guard, live, wallet],
  );

  const acceptOffer = useCallback(
    async (offerId: string, asset: NeukoAsset) => {
      if (!guard()) return;
      if (live) {
        try {
          const conn = getConnection();
          const info = await conn.getAccountInfo(new PublicKey(offerId));
          if (!info) {
            toast.error('Offer account not found on-chain');
            return;
          }
          const bidder = new PublicKey(info.data.subarray(8, 40));
          const collectionPubkey = new PublicKey(info.data.subarray(40, 72));
          const currencyCode = info.data[112];
          const nonce = info.data.readBigUInt64LE(113);
          const currency: Currency = currencyCode === 1 ? 'gboy' : 'sol';

          const collectionKey: CollectionKey =
            collectionPubkey.toBase58() === COLLECTIONS.badges.address.toBase58()
              ? 'badges'
              : 'harmies';

          const ixs = [];

          if (currency === 'gboy') {
            const { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } =
              await import('@solana/spl-token');
            const sellerGboy = getAssociatedTokenAddressSync(GBOY_MINT, wallet.publicKey!);
            const creator = COLLECTIONS[collectionKey].creator;
            const creatorGboy = getAssociatedTokenAddressSync(GBOY_MINT, creator, true);

            ixs.push(
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey!,
                sellerGboy,
                wallet.publicKey!,
                GBOY_MINT,
              ),
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey!,
                creatorGboy,
                creator,
                GBOY_MINT,
              ),
            );
          }

          ixs.push(prog.buildAcceptOfferIx({
            seller: wallet.publicKey!,
            bidder,
            nonce,
            asset: new PublicKey(asset.id),
            collection: collectionKey,
            currency,
          }));

          await toast.promise(sendSmart(wallet, ixs), {
            loading: 'Accepting offer on-chain…',
            success: 'Offer accepted!',
            error: (e) => `Failed: ${e.message ?? e}`,
          });
        } catch {
          /* handled by toast */
        }
        return;
      }
      toast.error('Accepting offers not available — NEUKO program not detected on this network');
    },
    [guard, live, wallet],
  );

  /** Batch-buy many listings, chunked so each tx stays under the size/CU limit. */
  const sweep = useCallback(
    async (listings: Listing[]) => {
      if (!guard() || listings.length === 0) return;
      if (live) {
        const { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } =
          await import('@solana/spl-token');
        const CHUNK = 5; // conservative; ALTs let more fit, but stay safe
        const chunks: Listing[][] = [];
        for (let i = 0; i < listings.length; i += CHUNK) chunks.push(listings.slice(i, i + CHUNK));

        await toast.promise(
          (async () => {
            for (let c = 0; c < chunks.length; c++) {
              const ixs = [];
              for (const l of chunks[c]) {
                const common = {
                  buyer: wallet.publicKey!,
                  seller: new PublicKey(l.seller),
                  asset: new PublicKey(l.asset.id),
                  collection: l.asset.collection,
                  maxPrice: BigInt(Math.ceil(l.price * (l.currency === 'sol' ? 1e9 : 10 ** GBOY_DECIMALS) * 1.01)),
                };
                if (l.currency === 'gboy') {
                  const sellerAta = getAssociatedTokenAddressSync(GBOY_MINT, common.seller);
                  const creator = COLLECTIONS[common.collection].creator;
                  const creatorAta = getAssociatedTokenAddressSync(GBOY_MINT, creator, true);
                  ixs.push(
                    createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey!, sellerAta, common.seller, GBOY_MINT),
                    createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey!, creatorAta, creator, GBOY_MINT),
                  );
                  ixs.push(prog.buildPurchaseGboyIx(common));
                } else {
                  ixs.push(prog.buildPurchaseSolIx(common));
                }
              }
              await sendSmart(wallet, ixs);
            }
          })(),
          {
            loading: `Sweeping ${listings.length} items${chunks.length > 1 ? ` in ${chunks.length} txns` : ''}…`,
            success: 'Swept!',
            error: (e) => `Failed: ${e.message ?? e}`,
          },
        );
        return;
      }
      toast.error('Sweep purchase not available — NEUKO program not detected on this network');
    },
    [guard, live, wallet],
  );

  return {
    buy,
    list,
    cancelList,
    createSwap,
    acceptSwap,
    cancelSwap,
    makeOffer,
    cancelOffer,
    acceptOffer,
    sweep,
    live,
  };
}
