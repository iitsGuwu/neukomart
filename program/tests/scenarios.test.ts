/**
 * Exhaustive scenario coverage for neuko_market on devnet — the paths the happy
 * and security suites don't reach: update_listing, multi-asset swaps, SOL/$GBOY
 * top-ups (offered & requested), cancel_swap, floor-bid offers, and the full set
 * of edge/negative reverts.
 *
 *   npx tsx tests/scenarios.test.ts
 *
 * Swap/offer tests use fixed nonces + reclaim-if-exists so a mid-run failure is
 * cleaned up on the next run (assets returned to their canonical owner).
 */
import {
  program, conn, A, B, GBOY, HARMIES, BADGES, FOREIGN, MPL_CORE, SYS, state,
  BN, PublicKey, SystemProgram, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  retry, ownerOf, gboyBal, solBal, listingPda, swapPda, offerPda, ra, gboyUnits, ataOf, ensureGboyAta, ensureOwner,
  createRunner, assert, expectRevert, creatorFor,
} from './_shared';

const { test, finish } = createRunner('neuko_market EXHAUSTIVE scenarios');
const LAMPORTS = 1_000_000_000;
const sa = (k: string) => new PublicKey(state.scenarioAssets[k]);
const wAtaA = getAssociatedTokenAddressSync(GBOY, A.publicKey);
const wAtaB = getAssociatedTokenAddressSync(GBOY, B.publicKey);

async function exists(pk: PublicKey) { return !!(await retry(() => conn.getAccountInfo(pk, 'confirmed'), 'chk')); }

async function clearListing(asset: PublicKey, coll = HARMIES, seller = A) {
  const listing = listingPda(asset);
  if (await exists(listing)) {
    await retry(() => program.methods.cancelListing()
      .accountsPartial({ seller: seller.publicKey, listing, asset, collection: coll, mplCoreProgram: MPL_CORE, systemProgram: SYS })
      .signers([seller]).rpc(), 'pre-clear-listing');
  }
}
async function cancelSwapIfExists(nonce: BN, offered: PublicKey[], coll: PublicKey, gboy = false) {
  const swap = swapPda(A.publicKey, nonce);
  if (!(await exists(swap))) return;
  const rem = offered.flatMap((a) => [ra(a, true), ra(coll, false)]);
  await retry(() => program.methods.cancelSwap()
    .accountsPartial({ maker: A.publicKey, swapOffer: swap, makerGboy: gboy ? wAtaA : null, swapGboy: gboy ? ataOf(swap) : null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
    .remainingAccounts(rem).signers([A]).rpc(), 'reclaim-swap');
}
async function cancelOfferIfExists(nonce: BN, gboy = false) {
  const offer = offerPda(B.publicKey, nonce);
  if (!(await exists(offer))) return;
  await retry(() => program.methods.cancelOffer()
    .accountsPartial({ bidder: B.publicKey, offer, bidderGboy: gboy ? wAtaB : null, offerGboy: gboy ? ataOf(offer) : null, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
    .signers([B]).rpc(), 'reclaim-offer');
}
const swapArgs = (o: Partial<any>) => ({ offeredCount: 0, requestedAssets: [], solOffered: new BN(0), gboyOffered: new BN(0), solRequested: new BN(0), gboyRequested: new BN(0), taker: null, ...o });

(async () => {
  // ============================ update_listing ============================
  await test('update_listing changes price → buy clears at the NEW price', async () => {
    const a = sa('HA1'); await clearListing(a); await ensureOwner(a, A, HARMIES);
    const listing = listingPda(a);
    await retry(() => program.methods.listAsset(new BN(0.01 * LAMPORTS), { sol: {} }).accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS }).signers([A]).rpc(), 'list');
    const newP = new BN(0.02 * LAMPORTS);
    await retry(() => program.methods.updateListing(newP, { sol: {} }).accountsPartial({ seller: A.publicKey, listing }).signers([A]).rpc(), 'update');
    const before = await solBal(A.publicKey);
    await retry(() => program.methods.purchaseWithSol(newP).accountsPartial({ buyer: B.publicKey, seller: A.publicKey, listing, asset: a, collection: HARMIES, creator: creatorFor(HARMIES), mplCoreProgram: MPL_CORE, systemProgram: SYS }).signers([B]).rpc(), 'buy');
    assert((await ownerOf(a)) === B.publicKey.toBase58(), 'asset to buyer');
    assert((await solBal(A.publicKey)) - before >= newP.toNumber() * 0.9, 'seller received the new price');
  });

  await test('update_listing changes currency SOL→$GBOY → $GBOY purchase works', async () => {
    const a = sa('HA1'); await clearListing(a); await ensureOwner(a, A, HARMIES);
    const listing = listingPda(a);
    await retry(() => program.methods.listAsset(new BN(0.01 * LAMPORTS), { sol: {} }).accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS }).signers([A]).rpc(), 'list');
    const price = gboyUnits(30);
    await retry(() => program.methods.updateListing(price, { gboy: {} }).accountsPartial({ seller: A.publicKey, listing }).signers([A]).rpc(), 'update-cur');
    const before = await gboyBal(wAtaA);
    const creator = creatorFor(HARMIES);
    const creatorAta = await ensureGboyAta(creator);
    const creatorBefore = await gboyBal(creatorAta);
    await retry(() => program.methods.purchaseWithGboy(price).accountsPartial({ buyer: B.publicKey, seller: A.publicKey, listing, gboyMint: GBOY, buyerGboy: wAtaB, sellerGboy: wAtaA, asset: a, collection: HARMIES, creator, creatorGboy: creatorAta, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS }).signers([B]).rpc(), 'buy-gboy');
    assert((await ownerOf(a)) === B.publicKey.toBase58(), 'asset to buyer');
    const pB = BigInt(price.toString()); const roy = (pB * 500n) / 10000n; // 5% royalty
    assert((await gboyBal(wAtaA)) - before === pB - roy, 'seller paid 95% in $GBOY');
    assert((await gboyBal(creatorAta)) - creatorBefore === roy, 'creator paid 5% royalty in $GBOY');
  });

  await test('update_listing by a non-seller is rejected (NotSeller)', async () => {
    const a = sa('HA1'); await clearListing(a); await ensureOwner(a, A, HARMIES);
    const listing = listingPda(a);
    await retry(() => program.methods.listAsset(new BN(0.01 * LAMPORTS), { sol: {} }).accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS }).signers([A]).rpc(), 'list');
    await expectRevert(() => program.methods.updateListing(new BN(1), { sol: {} }).accountsPartial({ seller: B.publicKey, listing }).signers([B]).rpc(), /NotSeller|ConstraintHasOne/, 'nonseller-update');
    await clearListing(a);
  });

  await test('update_listing to price 0 is rejected (ZeroPrice)', async () => {
    const a = sa('HA1'); await clearListing(a); await ensureOwner(a, A, HARMIES);
    const listing = listingPda(a);
    await retry(() => program.methods.listAsset(new BN(0.01 * LAMPORTS), { sol: {} }).accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS }).signers([A]).rpc(), 'list');
    await expectRevert(() => program.methods.updateListing(new BN(0), { sol: {} }).accountsPartial({ seller: A.publicKey, listing }).signers([A]).rpc(), /ZeroPrice/, 'zero-update');
    await clearListing(a);
  });

  // ============================ multi-asset & top-up swaps ============================
  async function runSwap(label: string, nonce: BN, opts: { offered: string[]; requested: string[]; offColl?: PublicKey; reqColl?: PublicKey; solOffered?: number; gboyOffered?: number; solRequested?: number; gboyRequested?: number; taker?: PublicKey | null }) {
    const offColl = opts.offColl ?? HARMIES, reqColl = opts.reqColl ?? HARMIES;
    const offered = opts.offered.map(sa), requested = opts.requested.map(sa);
    const gboy = (opts.gboyOffered ?? 0) > 0;
    await cancelSwapIfExists(nonce, offered, offColl, gboy);
    for (const a of offered) await ensureOwner(a, A, offColl);
    for (const a of requested) await ensureOwner(a, B, reqColl);
    const swap = swapPda(A.publicKey, nonce);
    const swapGboyAta = gboy ? await ensureGboyAta(swap) : null;
    const args = swapArgs({ offeredCount: offered.length, requestedAssets: requested, solOffered: new BN((opts.solOffered ?? 0) * LAMPORTS), gboyOffered: gboy ? gboyUnits(opts.gboyOffered!) : new BN(0), solRequested: new BN((opts.solRequested ?? 0) * LAMPORTS), gboyRequested: (opts.gboyRequested ?? 0) > 0 ? gboyUnits(opts.gboyRequested!) : new BN(0), taker: opts.taker ?? null });
    await retry(() => program.methods.createSwap(nonce, args)
      .accountsPartial({ maker: A.publicKey, swapOffer: swap, makerGboy: gboy ? wAtaA : null, swapGboy: swapGboyAta, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS })
      .remainingAccounts(offered.flatMap((a) => [ra(a, true), ra(offColl, false)]))
      .signers([A]).rpc(), `${label}-create`);
    return { swap, offered, requested, offColl, reqColl, swapGboyAta, gboyReq: (opts.gboyRequested ?? 0) > 0 };
  }

  await test('swap 2↔2 NFTs settles all four owners atomically', async () => {
    const n = new BN(2001);
    const s = await runSwap('2x2', n, { offered: ['HA1', 'HA2'], requested: ['HB1', 'HB2'] });
    await retry(() => program.methods.acceptSwap().accountsPartial({ taker: B.publicKey, maker: A.publicKey, swapOffer: s.swap, takerGboy: null, makerGboy: null, swapGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
      .remainingAccounts([...s.requested.flatMap((a) => [ra(a, true), ra(HARMIES, false)]), ...s.offered.flatMap((a) => [ra(a, true), ra(HARMIES, false)])]).signers([B]).rpc(), 'accept');
    for (const a of s.offered) assert((await ownerOf(a)) === B.publicKey.toBase58(), 'offered → taker');
    for (const a of s.requested) assert((await ownerOf(a)) === A.publicKey.toBase58(), 'requested → maker');
  });

  await test('swap many↔one (3 offered, 1 requested)', async () => {
    const n = new BN(2002);
    const s = await runSwap('3x1', n, { offered: ['HA1', 'HA2', 'HA3'], requested: ['HB1'] });
    await retry(() => program.methods.acceptSwap().accountsPartial({ taker: B.publicKey, maker: A.publicKey, swapOffer: s.swap, takerGboy: null, makerGboy: null, swapGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
      .remainingAccounts([ra(s.requested[0], true), ra(HARMIES, false), ...s.offered.flatMap((a) => [ra(a, true), ra(HARMIES, false)])]).signers([B]).rpc(), 'accept');
    for (const a of s.offered) assert((await ownerOf(a)) === B.publicKey.toBase58(), 'all 3 → taker');
    assert((await ownerOf(s.requested[0])) === A.publicKey.toBase58(), 'requested → maker');
  });

  await test('swap with SOL top-up OFFERED → taker receives the SOL', async () => {
    const n = new BN(2003);
    const s = await runSwap('sol-off', n, { offered: ['HA1'], requested: ['HB1'], solOffered: 0.005 });
    const before = await solBal(B.publicKey);
    await retry(() => program.methods.acceptSwap().accountsPartial({ taker: B.publicKey, maker: A.publicKey, swapOffer: s.swap, takerGboy: null, makerGboy: null, swapGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
      .remainingAccounts([ra(s.requested[0], true), ra(HARMIES, false), ra(s.offered[0], true), ra(HARMIES, false)]).signers([B]).rpc(), 'accept');
    assert((await ownerOf(s.offered[0])) === B.publicKey.toBase58(), 'NFT → taker');
    assert((await solBal(B.publicKey)) - before >= 0.005 * LAMPORTS * 0.9, 'taker received the SOL top-up');
  });

  await test('swap with SOL top-up REQUESTED → taker pays the SOL to maker', async () => {
    const n = new BN(2004);
    const s = await runSwap('sol-req', n, { offered: ['HA1'], requested: ['HB1'], solRequested: 0.005 });
    const before = await solBal(A.publicKey);
    await retry(() => program.methods.acceptSwap().accountsPartial({ taker: B.publicKey, maker: A.publicKey, swapOffer: s.swap, takerGboy: null, makerGboy: null, swapGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
      .remainingAccounts([ra(s.requested[0], true), ra(HARMIES, false), ra(s.offered[0], true), ra(HARMIES, false)]).signers([B]).rpc(), 'accept');
    assert((await ownerOf(s.offered[0])) === B.publicKey.toBase58(), 'NFT → taker');
    assert((await solBal(A.publicKey)) - before >= 0.005 * LAMPORTS * 0.9, 'maker received the requested SOL');
  });

  await test('swap with $GBOY top-up REQUESTED → taker pays $GBOY to maker (legit redirect path)', async () => {
    const n = new BN(2005);
    const s = await runSwap('gboy-req', n, { offered: ['HA1'], requested: ['HB1'], gboyRequested: 10 });
    const before = await gboyBal(wAtaA);
    await retry(() => program.methods.acceptSwap().accountsPartial({ taker: B.publicKey, maker: A.publicKey, swapOffer: s.swap, takerGboy: wAtaB, makerGboy: wAtaA, swapGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
      .remainingAccounts([ra(s.requested[0], true), ra(HARMIES, false), ra(s.offered[0], true), ra(HARMIES, false)]).signers([B]).rpc(), 'accept');
    assert((await ownerOf(s.offered[0])) === B.publicKey.toBase58(), 'NFT → taker');
    assert((await gboyBal(wAtaA)) - before === BigInt(gboyUnits(10).toString()), 'maker received the requested $GBOY');
  });

  await test('designated-taker swap: the designated taker CAN accept', async () => {
    const n = new BN(2006);
    const s = await runSwap('gated-ok', n, { offered: ['HA1'], requested: ['HB1'], taker: B.publicKey });
    await retry(() => program.methods.acceptSwap().accountsPartial({ taker: B.publicKey, maker: A.publicKey, swapOffer: s.swap, takerGboy: null, makerGboy: null, swapGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
      .remainingAccounts([ra(s.requested[0], true), ra(HARMIES, false), ra(s.offered[0], true), ra(HARMIES, false)]).signers([B]).rpc(), 'accept');
    assert((await ownerOf(s.offered[0])) === B.publicKey.toBase58(), 'designated taker received the NFT');
  });

  await test('cancel_swap (SOL top-up) → maker reclaims the NFT and the SOL', async () => {
    const n = new BN(2007);
    const s = await runSwap('cancel-sol', n, { offered: ['HA1'], requested: ['HB1'], solOffered: 0.005 });
    assert((await ownerOf(s.offered[0])) === s.swap.toBase58(), 'escrowed');
    await retry(() => program.methods.cancelSwap().accountsPartial({ maker: A.publicKey, swapOffer: s.swap, makerGboy: null, swapGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
      .remainingAccounts([ra(s.offered[0], true), ra(HARMIES, false)]).signers([A]).rpc(), 'cancel');
    assert((await ownerOf(s.offered[0])) === A.publicKey.toBase58(), 'NFT reclaimed by maker');
    assert(!(await exists(s.swap)), 'swap closed (SOL swept back)');
  });

  await test('cancel_swap ($GBOY top-up) → maker reclaims NFT + $GBOY, escrow ATA closed', async () => {
    const n = new BN(2008);
    const before = await gboyBal(wAtaA);
    const s = await runSwap('cancel-gboy', n, { offered: ['HA1'], requested: ['HB1'], gboyOffered: 10 });
    await retry(() => program.methods.cancelSwap().accountsPartial({ maker: A.publicKey, swapOffer: s.swap, makerGboy: wAtaA, swapGboy: s.swapGboyAta, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
      .remainingAccounts([ra(s.offered[0], true), ra(HARMIES, false)]).signers([A]).rpc(), 'cancel');
    assert((await ownerOf(s.offered[0])) === A.publicKey.toBase58(), 'NFT reclaimed');
    assert((await gboyBal(wAtaA)) === before, '$GBOY fully returned');
    assert(!(await exists(s.swapGboyAta!)), 'escrow ATA closed');
  });

  // ============================ swap negatives ============================
  await test('create_swap with nothing offered is rejected (EmptyOffer)', async () => {
    const n = new BN(2009);
    await expectRevert(() => program.methods.createSwap(n, swapArgs({ offeredCount: 0, requestedAssets: [sa('HB1')] }))
      .accountsPartial({ maker: A.publicKey, swapOffer: swapPda(A.publicKey, n), makerGboy: null, swapGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS })
      .remainingAccounts([]).signers([A]).rpc(), /EmptyOffer/, 'empty-offer');
  });

  await test('create_swap with nothing requested is rejected (EmptyRequest)', async () => {
    const n = new BN(2010); const a = sa('HA1'); await cancelSwapIfExists(n, [a], HARMIES); await ensureOwner(a, A, HARMIES);
    await expectRevert(() => program.methods.createSwap(n, swapArgs({ offeredCount: 1, requestedAssets: [] }))
      .accountsPartial({ maker: A.publicKey, swapOffer: swapPda(A.publicKey, n), makerGboy: null, swapGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS })
      .remainingAccounts([ra(a, true), ra(HARMIES, false)]).signers([A]).rpc(), /EmptyRequest/, 'empty-request');
  });

  await test('create_swap with >8 requested assets is rejected (TooManyAssets)', async () => {
    const n = new BN(2011); const a = sa('HA1'); await cancelSwapIfExists(n, [a], HARMIES); await ensureOwner(a, A, HARMIES);
    const nine = Array.from({ length: 9 }, () => PublicKey.unique());
    await expectRevert(() => program.methods.createSwap(n, swapArgs({ offeredCount: 1, requestedAssets: nine }))
      .accountsPartial({ maker: A.publicKey, swapOffer: swapPda(A.publicKey, n), makerGboy: null, swapGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS })
      .remainingAccounts([ra(a, true), ra(HARMIES, false)]).signers([A]).rpc(), /TooManyAssets/, 'too-many');
  });

  await test('accept_swap rejects a wrong delivered asset (AssetMismatch)', async () => {
    const n = new BN(2012);
    const s = await runSwap('mismatch', n, { offered: ['HA1'], requested: ['HB1'] });
    await ensureOwner(sa('HB2'), B, HARMIES);
    await expectRevert(() => program.methods.acceptSwap().accountsPartial({ taker: B.publicKey, maker: A.publicKey, swapOffer: s.swap, takerGboy: null, makerGboy: null, swapGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
      .remainingAccounts([ra(sa('HB2'), true), ra(HARMIES, false), ra(s.offered[0], true), ra(HARMIES, false)]).signers([B]).rpc(), /AssetMismatch/, 'asset-mismatch');
    await cancelSwapIfExists(n, s.offered, HARMIES);
  });

  await test('accept_swap rejects when taker does not own the requested asset (NotAssetOwner)', async () => {
    const n = new BN(2013);
    const s = await runSwap('notowner', n, { offered: ['HA1'], requested: ['HB1'] });
    await ensureOwner(sa('HB1'), A, HARMIES); // taker B no longer owns the requested asset
    await expectRevert(() => program.methods.acceptSwap().accountsPartial({ taker: B.publicKey, maker: A.publicKey, swapOffer: s.swap, takerGboy: null, makerGboy: null, swapGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS })
      .remainingAccounts([ra(sa('HB1'), true), ra(HARMIES, false), ra(s.offered[0], true), ra(HARMIES, false)]).signers([B]).rpc(), /NotAssetOwner/, 'not-owner');
    await cancelSwapIfExists(n, s.offered, HARMIES);
  });

  // ============================ offers ============================
  await test('floor offer (SOL): any matching asset can be sold into the bid', async () => {
    const n = new BN(3001); await cancelOfferIfExists(n);
    const a = sa('HA1'); await clearListing(a); await ensureOwner(a, A, HARMIES);
    const offer = offerPda(B.publicKey, n);
    await retry(() => program.methods.createOffer(n, { collection: HARMIES, asset: null, amount: new BN(0.01 * LAMPORTS), currency: { sol: {} } })
      .accountsPartial({ bidder: B.publicKey, offer, bidderGboy: null, offerGboy: null, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS }).signers([B]).rpc(), 'create-floor');
    const before = await solBal(A.publicKey);
    await retry(() => program.methods.acceptOffer().accountsPartial({ seller: A.publicKey, bidder: B.publicKey, offer, asset: a, collection: HARMIES, creator: creatorFor(HARMIES), creatorGboy: null, offerGboy: null, sellerGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS }).signers([A]).rpc(), 'accept-floor');
    assert((await ownerOf(a)) === B.publicKey.toBase58(), 'asset → bidder');
    assert((await solBal(A.publicKey)) - before >= 0.01 * LAMPORTS * 0.9, 'seller paid');
  });

  await test('create_offer with amount 0 is rejected (ZeroPrice)', async () => {
    const n = new BN(3003); await cancelOfferIfExists(n);
    await expectRevert(() => program.methods.createOffer(n, { collection: HARMIES, asset: null, amount: new BN(0), currency: { sol: {} } })
      .accountsPartial({ bidder: B.publicKey, offer: offerPda(B.publicKey, n), bidderGboy: null, offerGboy: null, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS }).signers([B]).rpc(), /ZeroPrice/, 'zero-amount');
  });

  await test('create_offer on a foreign collection is rejected (CollectionNotAllowed)', async () => {
    const n = new BN(3004); await cancelOfferIfExists(n);
    await expectRevert(() => program.methods.createOffer(n, { collection: FOREIGN, asset: null, amount: new BN(0.01 * LAMPORTS), currency: { sol: {} } })
      .accountsPartial({ bidder: B.publicKey, offer: offerPda(B.publicKey, n), bidderGboy: null, offerGboy: null, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS }).signers([B]).rpc(), /CollectionNotAllowed/, 'foreign-offer');
  });

  await test('accept_offer on a specific-asset bid rejects the wrong asset (AssetMismatch)', async () => {
    const n = new BN(3005); await cancelOfferIfExists(n);
    const target = sa('HA1'); await ensureOwner(target, A, HARMIES); await ensureOwner(sa('HA2'), A, HARMIES);
    const offer = offerPda(B.publicKey, n);
    await retry(() => program.methods.createOffer(n, { collection: HARMIES, asset: target, amount: new BN(0.01 * LAMPORTS), currency: { sol: {} } })
      .accountsPartial({ bidder: B.publicKey, offer, bidderGboy: null, offerGboy: null, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS }).signers([B]).rpc(), 'create-specific');
    await expectRevert(() => program.methods.acceptOffer().accountsPartial({ seller: A.publicKey, bidder: B.publicKey, offer, asset: sa('HA2'), collection: HARMIES, creator: creatorFor(HARMIES), creatorGboy: null, offerGboy: null, sellerGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS }).signers([A]).rpc(), /AssetMismatch/, 'wrong-asset');
    await cancelOfferIfExists(n);
  });

  await test('accept_offer rejects an asset the seller does not own (NotAssetOwner)', async () => {
    const n = new BN(3006); await cancelOfferIfExists(n);
    await ensureOwner(sa('HB1'), B, HARMIES); // owned by B, but A will try to deliver it
    const offer = offerPda(B.publicKey, n);
    await retry(() => program.methods.createOffer(n, { collection: HARMIES, asset: null, amount: new BN(0.01 * LAMPORTS), currency: { sol: {} } })
      .accountsPartial({ bidder: B.publicKey, offer, bidderGboy: null, offerGboy: null, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS }).signers([B]).rpc(), 'create-floor2');
    await expectRevert(() => program.methods.acceptOffer().accountsPartial({ seller: A.publicKey, bidder: B.publicKey, offer, asset: sa('HB1'), collection: HARMIES, creator: creatorFor(HARMIES), creatorGboy: null, offerGboy: null, sellerGboy: null, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS }).signers([A]).rpc(), /NotAssetOwner/, 'not-owned');
    await cancelOfferIfExists(n);
  });

  await test('cancel_offer (SOL) returns the full escrow to the bidder', async () => {
    const n = new BN(3007); await cancelOfferIfExists(n);
    const offer = offerPda(B.publicKey, n);
    const before = await solBal(B.publicKey);
    await retry(() => program.methods.createOffer(n, { collection: HARMIES, asset: null, amount: new BN(0.02 * LAMPORTS), currency: { sol: {} } })
      .accountsPartial({ bidder: B.publicKey, offer, bidderGboy: null, offerGboy: null, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS }).signers([B]).rpc(), 'create');
    await retry(() => program.methods.cancelOffer().accountsPartial({ bidder: B.publicKey, offer, bidderGboy: null, offerGboy: null, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS }).signers([B]).rpc(), 'cancel');
    assert(!(await exists(offer)), 'offer closed');
    assert((await solBal(B.publicKey)) >= before - 0.001 * LAMPORTS, 'bidder refunded (minus negligible fees)');
  });

  // ============================ listing negatives ============================
  await test('list_asset rejects an asset the seller does not own (NotAssetOwner)', async () => {
    const a = sa('HB1'); await clearListing(a, HARMIES, B); await ensureOwner(a, B, HARMIES);
    await expectRevert(() => program.methods.listAsset(new BN(0.01 * LAMPORTS), { sol: {} }).accountsPartial({ seller: A.publicKey, listing: listingPda(a), asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS }).signers([A]).rpc(), /NotAssetOwner/, 'list-not-owned');
  });

  await test('purchase_with_sol rejects a $GBOY listing (WrongCurrency)', async () => {
    const a = sa('HA1'); await clearListing(a); await ensureOwner(a, A, HARMIES);
    const listing = listingPda(a);
    await retry(() => program.methods.listAsset(gboyUnits(20), { gboy: {} }).accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS }).signers([A]).rpc(), 'list-gboy');
    await expectRevert(() => program.methods.purchaseWithSol(new BN(LAMPORTS)).accountsPartial({ buyer: B.publicKey, seller: A.publicKey, listing, asset: a, collection: HARMIES, creator: creatorFor(HARMIES), mplCoreProgram: MPL_CORE, systemProgram: SYS }).signers([B]).rpc(), /WrongCurrency/, 'wrong-cur-sol');
    await clearListing(a);
  });

  finish();
})();
