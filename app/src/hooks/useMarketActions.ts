import { useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useQueryClient } from '@tanstack/react-query';
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
import type { OnChainSwap } from '../lib/swaps';
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

/** Read an account, retrying a few times before concluding it doesn't exist —
 *  a single RPC read can transiently return null for an account that is live,
 *  which would otherwise abort a legitimate action with a misleading message. */
async function getAccountWithRetry(
  conn: ReturnType<typeof getConnection>,
  pubkey: PublicKey,
  attempts = 3,
) {
  for (let i = 0; i < attempts; i++) {
    try {
      const info = await conn.getAccountInfo(pubkey, 'confirmed');
      if (info) return info;
    } catch {
      /* transient — retry */
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 350 * (i + 1)));
  }
  return null;
}

/** Returns true when a real on-chain tx path is available. */
export function useCanTransact() {
  const { connected } = useWallet();
  const { data: deployed } = useProgramStatus();
  return { live: !!connected && !!deployed, deployed: !!deployed };
}

export function useMarketActions() {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const { live } = useCanTransact();
  const owner = wallet.publicKey?.toBase58();
  const market = store.useMarketState();
  const refreshSwaps = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['swaps'] }),
    [queryClient],
  );

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
          store.removeListing(listing.asset.id); // optimistic: drop from grid now
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
          // A frozen Core asset already carries Freeze/Transfer delegates from an
          // existing listing (NEUKO, Magic Eden or Tensor). NEUKO's list_asset
          // would try to re-add those plugins and fail with MPL Core 0xf
          // ("plugin already exists"). Stop early with an actionable message.
          if (asset.frozen) {
            toast.error("This NFT is already listed elsewhere (it's frozen). Delist it on that marketplace first, then list on NEUKO.");
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
          // optimistic: show in the grid + portfolio immediately
          store.addListing({
            id: 'listing-' + asset.id,
            asset,
            seller: owner!,
            price,
            currency,
            origin: 'neukomart',
            createdAt: Math.floor(Date.now() / 1000),
          });
        } catch {
          /* handled by toast */
        }
        return;
      }
      toast.error('Listing not available — NEUKO program not detected on this network');
    },
    [guard, live, wallet, owner],
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
          // External (Magic Eden / Tensor) listings have no NEUKO listing PDA —
          // cancelling them on-chain would fail with AccountNotFound. They must
          // be delisted on the originating marketplace.
          if (listing.origin === 'magiceden' || listing.origin === 'tensor') {
            const url = originUrl(listing.origin, listing.asset.id);
            toast(`This is a ${listing.origin === 'tensor' ? 'Tensor' : 'Magic Eden'} listing — manage it on that marketplace.`, { icon: 'ℹ️' });
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
            return;
          }
          const ix = prog.buildCancelListingIx({
            seller: wallet.publicKey!,
            asset: new PublicKey(assetId),
            collection: listing.asset.collection,
          });
          // Let the cancel tx be the source of truth (an unreliable getAccountInfo
          // read could falsely report a live listing as gone). Only if the program
          // itself reverts with AccountNotInitialized — i.e. the PDA really was
          // already closed (sold, or a stale indexer entry) — do we treat it as a
          // phantom and clear it. Any other failure surfaces normally.
          const toastId = toast.loading('Delisting NFT on-chain…');
          try {
            await sendSmart(wallet, [ix]);
            toast.success('Listing cancelled!', { id: toastId });
            store.removeListing(assetId); // optimistic: drop from grid + portfolio now
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (/already initialized|accountnotinitialized|account not initialized/i.test(msg)) {
              store.removeListing(assetId);
              toast('That listing was already removed on-chain — cleared it from your view.', { id: toastId, icon: 'ℹ️' });
            } else {
              toast.error(`Failed: ${msg}`, { id: toastId });
            }
          }
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
    async (give: SwapSide, want: SwapSide, taker?: string, mySwaps: OnChainSwap[] = []) => {
      if (!guard()) return;
      if (!live) {
        toast.error('Swaps need the NEUKO program — connect a wallet on mainnet');
        return;
      }
      try {
        // Re-offering an asset that's escrowed in one of my OWN open swaps means
        // this is a counter (or a replacement) of that swap. create_swap can't
        // escrow an asset I no longer hold, so cancel those swaps first, in the
        // same tx — this both unlocks the asset AND replaces my previous offer so
        // a back-and-forth negotiation never piles up duplicate offers.
        const offeringIds = new Set(give.assets.map((a) => a.id));
        const conflicts = mySwaps.filter((s) => s.give.assets.some((a) => offeringIds.has(a.id)));
        const escrowedByMe = new Set(conflicts.flatMap((s) => s.give.assets.map((a) => a.id)));

        // A listed NFT is frozen with marketplace delegates — escrowing it into
        // the swap would fail. (An asset I'm re-offering from my own swap isn't
        // frozen, just escrowed — it's released by the cancels above.)
        const frozenGive = give.assets.find((a) => a.frozen && !escrowedByMe.has(a.id));
        if (frozenGive) {
          toast.error(`${frozenGive.name} is currently listed — delist it before swapping it.`);
          return;
        }
        const offered = give.assets.map((a) => ({ asset: new PublicKey(a.id), collection: a.collection }));
        const requested = want.assets.map((a) => ({ asset: new PublicKey(a.id), collection: a.collection }));
        const solOffered = give.sol > 0 ? prog.solToLamports(give.sol) : 0n;
        const gboyOffered = give.gboy > 0 ? prog.gboyToBase(give.gboy) : 0n;
        const solRequested = want.sol > 0 ? prog.solToLamports(want.sol) : 0n;
        const gboyRequested = want.gboy > 0 ? prog.gboyToBase(want.gboy) : 0n;

        if (offered.length === 0 && solOffered === 0n && gboyOffered === 0n) {
          toast.error('Offer at least one asset, SOL or $GBOY');
          return;
        }
        if (requested.length === 0 && solRequested === 0n && gboyRequested === 0n) {
          toast.error('Request at least one asset, SOL or $GBOY');
          return;
        }
        if (offered.length > 8 || requested.length > 8) {
          toast.error('A swap can hold at most 8 assets per side');
          return;
        }
        let takerPk: PublicKey | null = null;
        if (taker) {
          try {
            takerPk = new PublicKey(taker);
          } catch {
            toast.error('Invalid counterparty address');
            return;
          }
        }

        const { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } =
          await import('@solana/spl-token');
        const nonce = BigInt(Date.now());
        const [swap] = prog.swapPda(wallet.publicKey!, nonce);
        const ixs = [];

        // Cancel the prior offer(s) this one replaces, releasing their escrow.
        for (const cs of conflicts) {
          const csOffered = cs.give.assets.map((a) => ({ asset: new PublicKey(a.id), collection: a.collection }));
          const csGboy = cs.give.gboy > 0;
          if (csGboy) {
            const myGboy = getAssociatedTokenAddressSync(GBOY_MINT, wallet.publicKey!);
            ixs.push(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey!, myGboy, wallet.publicKey!, GBOY_MINT));
          }
          ixs.push(prog.buildCancelSwapIx({ maker: wallet.publicKey!, nonce: BigInt(cs.nonce), offered: csOffered, usesGboy: csGboy }));
        }

        if (gboyOffered > 0n) {
          const swapGboy = getAssociatedTokenAddressSync(GBOY_MINT, swap, true);
          // The escrow ATA must exist before create_swap transfers $GBOY into it.
          ixs.push(
            createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey!, swapGboy, swap, GBOY_MINT),
          );
        }
        ixs.push(
          prog.buildCreateSwapIx({
            maker: wallet.publicKey!,
            nonce,
            offered,
            requested,
            solOffered,
            gboyOffered,
            solRequested,
            gboyRequested,
            taker: takerPk,
          }),
        );
        await toast.promise(sendSmart(wallet, ixs), {
          loading: conflicts.length ? 'Submitting counter — replacing your previous offer…' : 'Creating swap offer on-chain…',
          success: conflicts.length ? 'Counter sent — previous offer replaced.' : 'Swap offer created — your assets are escrowed!',
          error: (e) => `Failed: ${e.message ?? e}`,
        });
        refreshSwaps(); // show it under "My offers"
      } catch {
        /* handled by toast */
      }
    },
    [guard, live, wallet, refreshSwaps],
  );

  // Swaps are read straight from the chain (see lib/swaps.ts), so accept/cancel
  // get the full swap (nonce + escrowed asset list) and rebuild the ix directly.
  const acceptSwap = useCallback(
    async (swap: OnChainSwap, mySwaps: OnChainSwap[] = []) => {
      if (!guard()) return;
      if (!live) {
        toast.error('Swaps need the NEUKO program — connect a wallet on mainnet');
        return;
      }
      if (swap.taker && swap.taker !== owner) {
        toast.error('This swap is locked to a specific counterparty.');
        return;
      }

      // The taker delivers the requested NFTs to the maker. create_swap ESCROWS
      // offered assets into the swap PDA, so an asset I put up in one of my OWN
      // open swaps is owned by that PDA — I can't deliver it until that swap is
      // cancelled. This is exactly the case when I accept a counter of my own
      // offer (it asks for the very asset my original swap escrowed). Detect such
      // swaps and cancel them first, in the same transaction, so the assets are
      // back in my hands before the accept transfers them onward.
      const requestedIds = new Set(swap.want.assets.map((a) => a.id));
      const conflicts = mySwaps.filter(
        (s) => s.id !== swap.id && s.maker === owner && s.give.assets.some((a) => requestedIds.has(a.id)),
      );
      const escrowedByMe = new Set(conflicts.flatMap((s) => s.give.assets.map((a) => a.id)));

      // A requested asset I'm NOT escrowing but have listed (frozen) also can't be
      // delivered — surface that before sending.
      const frozenWant = swap.want.assets.find((a) => a.frozen && !escrowedByMe.has(a.id));
      if (frozenWant) {
        toast.error(`${frozenWant.name} is listed — delist it before accepting this swap.`);
        return;
      }

      try {
        const { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } =
          await import('@solana/spl-token');
        const maker = new PublicKey(swap.maker);
        const nonce = BigInt(swap.nonce);
        const offered = swap.give.assets.map((a) => ({ asset: new PublicKey(a.id), collection: a.collection }));
        const requested = swap.want.assets.map((a) => ({ asset: new PublicKey(a.id), collection: a.collection }));
        const usesGboy = swap.give.gboy > 0 || swap.want.gboy > 0;

        const ixs = [];

        // 1) Release assets locked in my own swaps that this accept must deliver.
        for (const cs of conflicts) {
          const csOffered = cs.give.assets.map((a) => ({ asset: new PublicKey(a.id), collection: a.collection }));
          const csGboy = cs.give.gboy > 0;
          if (csGboy) {
            const myGboy = getAssociatedTokenAddressSync(GBOY_MINT, wallet.publicKey!);
            ixs.push(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey!, myGboy, wallet.publicKey!, GBOY_MINT));
          }
          ixs.push(prog.buildCancelSwapIx({ maker: wallet.publicKey!, nonce: BigInt(cs.nonce), offered: csOffered, usesGboy: csGboy }));
        }

        // 2) $GBOY ATAs for the accept: taker may receive escrowed $GBOY and/or pay it.
        if (usesGboy) {
          const takerGboy = getAssociatedTokenAddressSync(GBOY_MINT, wallet.publicKey!);
          const makerGboy = getAssociatedTokenAddressSync(GBOY_MINT, maker);
          ixs.push(
            createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey!, takerGboy, wallet.publicKey!, GBOY_MINT),
            createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey!, makerGboy, maker, GBOY_MINT),
          );
        }

        // 3) The accept itself.
        ixs.push(
          prog.buildAcceptSwapIx({ taker: wallet.publicKey!, maker, nonce, requested, offered, usesGboy }),
        );

        await toast.promise(sendSmart(wallet, ixs), {
          loading: conflicts.length
            ? 'Accepting swap — replacing your original offer…'
            : 'Accepting swap on-chain…',
          success: 'Swap accepted — assets exchanged!',
          error: (e) => `Failed: ${e.message ?? e}`,
        });
        refreshSwaps();
      } catch {
        /* handled by toast */
      }
    },
    [guard, live, wallet, owner, refreshSwaps],
  );

  const cancelSwap = useCallback(
    async (swap: OnChainSwap) => {
      if (!guard()) return;
      if (!live) {
        toast.error('Swaps need the NEUKO program — connect a wallet on mainnet');
        return;
      }
      if (swap.maker !== owner) {
        toast.error('Only the swap maker can cancel it.');
        return;
      }
      try {
        const nonce = BigInt(swap.nonce);
        const offered = swap.give.assets.map((a) => ({ asset: new PublicKey(a.id), collection: a.collection }));
        const usesGboy = swap.give.gboy > 0; // only the maker's escrowed $GBOY is returned

        const ixs = [];
        if (usesGboy) {
          const { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } =
            await import('@solana/spl-token');
          const makerGboy = getAssociatedTokenAddressSync(GBOY_MINT, wallet.publicKey!);
          ixs.push(
            createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey!, makerGboy, wallet.publicKey!, GBOY_MINT),
          );
        }
        ixs.push(prog.buildCancelSwapIx({ maker: wallet.publicKey!, nonce, offered, usesGboy }));
        await toast.promise(sendSmart(wallet, ixs), {
          loading: 'Cancelling swap on-chain…',
          success: 'Swap cancelled — your assets are back.',
          error: (e) => `Failed: ${e.message ?? e}`,
        });
        refreshSwaps();
      } catch {
        /* handled by toast */
      }
    },
    [guard, live, wallet, owner, refreshSwaps],
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
          const [offerPk] = prog.offerPda(wallet.publicKey!, nonce);
          const ixs = [];

          if (currency === 'gboy') {
            const { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } =
              await import('@solana/spl-token');
            const offerGboy = getAssociatedTokenAddressSync(GBOY_MINT, offerPk, true);
            ixs.push(
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey!,
                offerGboy,
                offerPk,
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
          // optimistic: show in Portfolio "offers you've made" immediately
          store.addOffer({
            id: offerPk.toBase58(),
            bidder: owner!,
            collection,
            asset: target?.id,
            assetName: target?.name,
            image: target?.image,
            amount,
            currency,
            createdAt: Math.floor(Date.now() / 1000),
            status: 'open',
          });
        } catch {
          /* handled by toast */
        }
        return;
      }
      toast.error('Offers not available — NEUKO program not detected on this network');
    },
    [guard, live, wallet, owner],
  );

  const cancelOffer = useCallback(
    async (offerId: string) => {
      if (!guard()) return;
      if (live) {
        try {
          const conn = getConnection();
          const info = await getAccountWithRetry(conn, new PublicKey(offerId));
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
          store.removeOffer(offerId); // optimistic
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
          const info = await getAccountWithRetry(conn, new PublicKey(offerId));
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
          // optimistic: offer is filled, asset changes hands → clear both
          store.removeOffer(offerId);
          store.removeListing(asset.id);
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
    async (allListings: Listing[]) => {
      if (!guard() || allListings.length === 0) return;
      // Sweep is NEUKO-native only — external listings have no listing PDA and
      // would fail the on-chain purchase. Drop them with a heads-up.
      const listings = allListings.filter((l) => !l.origin || l.origin === 'neukomart');
      const skipped = allListings.length - listings.length;
      if (skipped > 0) {
        toast(`${skipped} Magic Eden/Tensor item${skipped > 1 ? 's' : ''} skipped — buy those on their marketplace.`, { icon: 'ℹ️' });
      }
      if (listings.length === 0) return;
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
              for (const l of chunks[c]) store.removeListing(l.asset.id); // optimistic
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
