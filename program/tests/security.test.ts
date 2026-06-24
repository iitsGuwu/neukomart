/**
 * Negative / security + $GBOY-escrow tests for neuko_market on devnet.
 * Asserts the program's guard rails actually REVERT on-chain, and exercises the
 * PDA-as-token-authority escrow paths ($GBOY offers and swap top-ups).
 *
 *   npx tsx tests/security.test.ts
 */
import {
  program, conn, A, B, GBOY, HARMIES, BADGES, MPL_CORE, SYS, asset,
  BN, PublicKey, SystemProgram, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  retry, ownerOf, gboyBal, listingPda, swapPda, offerPda, ra, gboyUnits, ensureGboyAta, ensureOwner,
  createRunner, assert, expectRevert, creatorFor,
} from './_shared';

const { test, finish } = createRunner('neuko_market SECURITY + $GBOY-escrow tests');

const walletAta = (kp: typeof A) => getAssociatedTokenAddressSync(GBOY, kp.publicKey);

async function clearListing(a: PublicKey) {
  const listing = listingPda(a);
  if (await retry(() => conn.getAccountInfo(listing, 'confirmed'), 'chk-listing')) {
    await retry(() =>
      program.methods.cancelListing()
        .accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS })
        .signers([A]).rpc(), 'pre-clear');
  }
}

(async () => {
  // ============================ NEGATIVE / GUARDS ============================

  await test('list_asset rejects price = 0 (ZeroPrice)', async () => {
    const a = asset('H_A_cancel');
    await ensureOwner(a, A, HARMIES);
    await clearListing(a);
    await expectRevert(() =>
      program.methods.listAsset(new BN(0), { sol: {} })
        .accountsPartial({ seller: A.publicKey, listing: listingPda(a), asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS })
        .signers([A]).rpc(), /ZeroPrice/, 'zero-price');
  });

  await test('cancel_listing rejects a non-seller (NotSeller)', async () => {
    const a = asset('H_A_cancel');
    await ensureOwner(a, A, HARMIES);
    await clearListing(a);
    const listing = listingPda(a);
    await retry(() =>
      program.methods.listAsset(new BN(10_000_000), { sol: {} })
        .accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS })
        .signers([A]).rpc(), 'list');
    await expectRevert(() =>
      program.methods.cancelListing()
        .accountsPartial({ seller: B.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS })
        .signers([B]).rpc(), /NotSeller|ConstraintHasOne/, 'non-seller-cancel');
    await clearListing(a); // cleanup (A cancels)
  });

  await test('purchase_with_gboy rejects a SOL listing (WrongCurrency)', async () => {
    const a = asset('H_A_cancel');
    await ensureOwner(a, A, HARMIES);
    await clearListing(a);
    const listing = listingPda(a);
    await retry(() =>
      program.methods.listAsset(new BN(10_000_000), { sol: {} })
        .accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS })
        .signers([A]).rpc(), 'list-sol');
    const creator = creatorFor(HARMIES);
    const creatorAta = await ensureGboyAta(creator);
    await expectRevert(() =>
      program.methods.purchaseWithGboy(new BN(10_000_000))
        .accountsPartial({
          buyer: B.publicKey, seller: A.publicKey, listing, gboyMint: GBOY,
          buyerGboy: walletAta(B), sellerGboy: walletAta(A), asset: a, collection: HARMIES,
          creator, creatorGboy: creatorAta,
          mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS,
        })
        .signers([B]).rpc(), /WrongCurrency/, 'wrong-currency');
    await clearListing(a);
  });

  await test('accept_swap enforces the designated taker (NotDesignatedTaker)', async () => {
    const offered = asset('B_A_swap');
    const requested = asset('B_B_swap');
    await ensureOwner(offered, A, BADGES);
    await ensureOwner(requested, B, BADGES);
    const nonce = new BN(Date.now());
    const swap = swapPda(A.publicKey, nonce);
    const args = { offeredCount: 1, requestedAssets: [requested], solOffered: new BN(0), gboyOffered: new BN(0), solRequested: new BN(0), gboyRequested: new BN(0), taker: B.publicKey };
    await retry(() =>
      program.methods.createSwap(nonce, args)
        .accountsPartial({ maker: A.publicKey, swapOffer: swap, makerGboy: undefined, swapGboy: undefined, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS })
        .remainingAccounts([ra(offered, true), ra(BADGES, false)])
        .signers([A]).rpc(), 'create-swap');
    // A (the maker, not designated taker B) tries to accept.
    await expectRevert(() =>
      program.methods.acceptSwap()
        .accountsPartial({ taker: A.publicKey, maker: A.publicKey, swapOffer: swap, takerGboy: undefined, makerGboy: undefined, swapGboy: undefined, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
        .remainingAccounts([ra(requested, true), ra(BADGES, false), ra(offered, true), ra(BADGES, false)])
        .signers([A]).rpc(), /NotDesignatedTaker/, 'designated-taker');
    // cleanup: maker cancels swap, reclaiming the escrowed badge (also covers cancel_swap).
    await retry(() =>
      program.methods.cancelSwap()
        .accountsPartial({ maker: A.publicKey, swapOffer: swap, makerGboy: undefined, swapGboy: undefined, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
        .remainingAccounts([ra(offered, true), ra(BADGES, false)])
        .signers([A]).rpc(), 'cancel-swap');
    assert((await ownerOf(offered)) === A.publicKey.toBase58(), 'maker should reclaim the escrowed badge on cancel');
  });

  await test('accept_swap blocks $GBOY payment redirect (maker_gboy must belong to the maker)', async () => {
    const offered = asset('B_A_swap');
    await ensureOwner(offered, A, BADGES);
    const nonce = new BN(Date.now());
    const swap = swapPda(A.publicKey, nonce);
    // Maker offers a badge and REQUESTS $GBOY — the taker must pay the maker.
    const args = { offeredCount: 1, requestedAssets: [], solOffered: new BN(0), gboyOffered: new BN(0), solRequested: new BN(0), gboyRequested: gboyUnits(10), taker: undefined };
    await retry(() =>
      program.methods.createSwap(nonce, args)
        .accountsPartial({ maker: A.publicKey, swapOffer: swap, makerGboy: undefined, swapGboy: undefined, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS })
        .remainingAccounts([ra(offered, true), ra(BADGES, false)])
        .signers([A]).rpc(), 'create-swap-gboyreq');
    // Attack: taker B supplies its OWN ata as maker_gboy → would redirect payment to itself.
    const takerAta = walletAta(B);
    await expectRevert(() =>
      program.methods.acceptSwap()
        .accountsPartial({ taker: B.publicKey, maker: A.publicKey, swapOffer: swap, takerGboy: takerAta, makerGboy: takerAta, swapGboy: undefined, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
        .remainingAccounts([ra(offered, true), ra(BADGES, false)])
        .signers([B]).rpc(), /WrongToken/, 'redirect-attack');
    await retry(() =>
      program.methods.cancelSwap()
        .accountsPartial({ maker: A.publicKey, swapOffer: swap, makerGboy: undefined, swapGboy: undefined, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
        .remainingAccounts([ra(offered, true), ra(BADGES, false)])
        .signers([A]).rpc(), 'cancel-swap');
  });

  await test('cancel_offer rejects a non-bidder (seed-bound to the bidder)', async () => {
    const nonce = new BN(Date.now());
    const offer = offerPda(B.publicKey, nonce);
    await retry(() =>
      program.methods.createOffer(nonce, { collection: HARMIES, asset: undefined, amount: new BN(10_000_000), currency: { sol: {} } })
        .accountsPartial({ bidder: B.publicKey, offer, bidderGboy: undefined, offerGboy: undefined, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS })
        .signers([B]).rpc(), 'create-offer');
    // A tries to cancel B's offer — PDA is seed-bound to the bidder, so it cannot resolve for A.
    await expectRevert(() =>
      program.methods.cancelOffer()
        .accountsPartial({ bidder: A.publicKey, offer, bidderGboy: undefined, offerGboy: undefined, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
        .signers([A]).rpc(), /NotBidder|ConstraintSeeds|2006/, 'non-bidder-cancel');
    await retry(() =>
      program.methods.cancelOffer()
        .accountsPartial({ bidder: B.publicKey, offer, bidderGboy: undefined, offerGboy: undefined, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
        .signers([B]).rpc(), 'cancel-offer');
  });

  await test('purchase_with_sol slippage guard: front-run price hike is rejected (PriceExceedsMax)', async () => {
    const a = asset('H_A_cancel');
    await ensureOwner(a, A, HARMIES);
    await clearListing(a);
    const listing = listingPda(a);
    const listed = new BN(10_000_000); // 0.01 SOL — what the buyer sees & agrees to
    await retry(() =>
      program.methods.listAsset(listed, { sol: {} })
        .accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS })
        .signers([A]).rpc(), 'list');
    // Seller front-runs the buyer's pending purchase.
    await retry(() =>
      program.methods.updateListing(new BN(80_000_000), { sol: {} })
        .accountsPartial({ seller: A.publicKey, listing })
        .signers([A]).rpc(), 'frontrun-update');
    // Buyer's max_price is what they agreed to (0.01) → must revert, not overcharge.
    await expectRevert(() =>
      program.methods.purchaseWithSol(listed)
        .accountsPartial({ buyer: B.publicKey, seller: A.publicKey, listing, asset: a, collection: HARMIES, creator: creatorFor(HARMIES), mplCoreProgram: MPL_CORE, systemProgram: SYS })
        .signers([B]).rpc(), /PriceExceedsMax/, 'slippage-guard');
    await clearListing(a); // cleanup
  });

  // ============================ $GBOY ESCROW PATHS ============================

  await test('$GBOY offer: create_offer + accept_offer (escrow ATA → seller, rent reclaimed)', async () => {
    const a = asset('H_A_offer');
    await ensureOwner(a, A, HARMIES);
    const nonce = new BN(Date.now());
    const offer = offerPda(B.publicKey, nonce);
    const amount = gboyUnits(25);
    const offerAta = await ensureGboyAta(offer);
    const sellerAta = walletAta(A);
    await retry(() =>
      program.methods.createOffer(nonce, { collection: HARMIES, asset: a, amount, currency: { gboy: {} } })
        .accountsPartial({ bidder: B.publicKey, offer, bidderGboy: walletAta(B), offerGboy: offerAta, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS })
        .signers([B]).rpc(), 'create-offer-gboy');
    assert((await gboyBal(offerAta)) === BigInt(amount.toString()), 'escrow ATA should hold the bid');
    const sellerBefore = await gboyBal(sellerAta);
    const creator = creatorFor(HARMIES);
    const creatorAta = await ensureGboyAta(creator);
    await retry(() =>
      program.methods.acceptOffer()
        .accountsPartial({ seller: A.publicKey, bidder: B.publicKey, offer, asset: a, collection: HARMIES, creator, creatorGboy: creatorAta, offerGboy: offerAta, sellerGboy: sellerAta, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
        .signers([A]).rpc(), 'accept-offer-gboy');
    assert((await ownerOf(a)) === B.publicKey.toBase58(), 'asset should go to the bidder');
    assert((await gboyBal(sellerAta)) - sellerBefore === BigInt(amount.toString()), 'seller paid in $GBOY');
    assert((await conn.getAccountInfo(offerAta)) === null, 'escrow ATA should be closed');
  });

  await test('$GBOY offer: cancel_offer returns the full escrow & closes the ATA', async () => {
    const nonce = new BN(Date.now());
    const offer = offerPda(B.publicKey, nonce);
    const amount = gboyUnits(15);
    const offerAta = await ensureGboyAta(offer);
    const bidderAta = walletAta(B);
    const before = await gboyBal(bidderAta);
    await retry(() =>
      program.methods.createOffer(nonce, { collection: HARMIES, asset: undefined, amount, currency: { gboy: {} } })
        .accountsPartial({ bidder: B.publicKey, offer, bidderGboy: bidderAta, offerGboy: offerAta, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS })
        .signers([B]).rpc(), 'create');
    await retry(() =>
      program.methods.cancelOffer()
        .accountsPartial({ bidder: B.publicKey, offer, bidderGboy: bidderAta, offerGboy: offerAta, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
        .signers([B]).rpc(), 'cancel');
    assert((await gboyBal(bidderAta)) === before, 'bidder should be fully refunded');
    assert((await conn.getAccountInfo(offer)) === null, 'offer should be closed');
    assert((await conn.getAccountInfo(offerAta)) === null, 'escrow ATA should be closed');
  });

  await test('$GBOY swap top-up: maker escrows $GBOY, taker delivers NFT & receives $GBOY', async () => {
    const requested = asset('B_B_swap');
    await ensureOwner(requested, B, BADGES);
    const nonce = new BN(Date.now());
    const swap = swapPda(A.publicKey, nonce);
    const amount = gboyUnits(20);
    const swapAta = await ensureGboyAta(swap);
    const takerAta = walletAta(B);
    const args = { offeredCount: 0, requestedAssets: [requested], solOffered: new BN(0), gboyOffered: amount, solRequested: new BN(0), gboyRequested: new BN(0), taker: undefined };
    await retry(() =>
      program.methods.createSwap(nonce, args)
        .accountsPartial({ maker: A.publicKey, swapOffer: swap, makerGboy: walletAta(A), swapGboy: swapAta, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS })
        .remainingAccounts([])
        .signers([A]).rpc(), 'create-swap-gboy');
    assert((await gboyBal(swapAta)) === BigInt(amount.toString()), 'swap escrow should hold the $GBOY top-up');
    const takerBefore = await gboyBal(takerAta);
    await retry(() =>
      program.methods.acceptSwap()
        .accountsPartial({ taker: B.publicKey, maker: A.publicKey, swapOffer: swap, takerGboy: takerAta, makerGboy: undefined, swapGboy: swapAta, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
        .remainingAccounts([ra(requested, true), ra(BADGES, false)])
        .signers([B]).rpc(), 'accept-swap-gboy');
    assert((await ownerOf(requested)) === A.publicKey.toBase58(), 'maker should receive the requested NFT');
    assert((await gboyBal(takerAta)) - takerBefore === BigInt(amount.toString()), 'taker should receive the $GBOY top-up');
    assert((await conn.getAccountInfo(swapAta)) === null, 'swap escrow ATA should be closed');
  });

  finish();
})();
