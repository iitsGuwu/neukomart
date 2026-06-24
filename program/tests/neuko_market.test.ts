/**
 * neuko_market devnet integration tests.
 *
 * Exercises the full trade surface against the program deployed on devnet, using
 * the throwaway assets created by `scripts/setup-devnet.ts` (the program must be
 * built+deployed with `--features devnet`).
 *
 *   npx tsx tests/neuko_market.test.ts
 *
 * The public devnet RPC rate-limits aggressively, so every chain call is wrapped
 * in exponential-backoff retry.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, signerIdentity, publicKey as umiPk } from '@metaplex-foundation/umi';
import { transferV1 } from '@metaplex-foundation/mpl-core';

const DEVNET = 'https://api.devnet.solana.com';
const MPL_CORE = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const SYS = SystemProgram.programId;

const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'devnet-assets.json'), 'utf8'));
const idl = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'target', 'idl', 'neuko_market.json'), 'utf8'));

const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'solana', 'id.json'), 'utf8'))),
);
const conn = new Connection(DEVNET, 'confirmed');
const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(payer), {
  commitment: 'confirmed',
  preflightCommitment: 'confirmed',
});
anchor.setProvider(provider);
const program = new anchor.Program(idl as anchor.Idl, provider);
const PROGRAM_ID = new PublicKey(idl.address);

const A = Keypair.fromSecretKey(Uint8Array.from(state.wallets.A.secret));
const B = Keypair.fromSecretKey(Uint8Array.from(state.wallets.B.secret));
const GBOY = new PublicKey(state.gboyMint);
const HARMIES = new PublicKey(state.collections.harmies);
const BADGES = new PublicKey(state.collections.badges);
const FOREIGN = new PublicKey(state.collections.foreign);
const asset = (k: string) => new PublicKey(state.assets[k]);

// ---- helpers ----------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retry<T>(fn: () => Promise<T>, label = 'op'): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < 8; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e);
      // Anchor surfaces program reverts immediately — don't retry those.
      if (/custom program error|AnchorError|Error Code|Error Number|0x[0-9a-f]+ /i.test(msg) && !/429|Too Many Requests|rate/i.test(msg)) {
        throw e;
      }
      await sleep(Math.min(800 * 2 ** i, 8000));
    }
  }
  throw new Error(`${label} failed after retries: ${lastErr?.message || lastErr}`);
}

async function ownerOf(a: PublicKey): Promise<string> {
  const info = await retry(() => conn.getAccountInfo(a, 'confirmed'), 'getAccountInfo');
  if (!info) throw new Error('asset account missing');
  // MPL Core AssetV1: [0]=key, [1..33]=owner
  return new PublicKey(info.data.subarray(1, 33)).toBase58();
}
async function gboyBal(ata: PublicKey): Promise<bigint> {
  const acc = await retry(() => getAccount(conn, ata, 'confirmed'), 'getAccount');
  return acc.amount;
}
async function solBal(pk: PublicKey): Promise<number> {
  return retry(() => conn.getBalance(pk, 'confirmed'), 'getBalance');
}
function listingPda(a: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from('listing'), a.toBuffer()], PROGRAM_ID)[0];
}
function swapPda(maker: PublicKey, nonce: BN) {
  return PublicKey.findProgramAddressSync([Buffer.from('swap'), maker.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)], PROGRAM_ID)[0];
}
function offerPda(bidder: PublicKey, nonce: BN) {
  return PublicKey.findProgramAddressSync([Buffer.from('offer'), bidder.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)], PROGRAM_ID)[0];
}
const ra = (pk: PublicKey, w: boolean) => ({ pubkey: pk, isSigner: false, isWritable: w });
const gboyUnits = (n: number) => new BN(n).mul(new BN(10).pow(new BN(10)));

const BADGES_CREATOR = new PublicKey("DQ1LJZ2ET1oHcCgojCN3kXakTQSkuCxgEqXguf2UrYS5");
const HARMIES_CREATOR = new PublicKey("57MFtfGrJheHeRzeSpARcUEBqa9jXELGGZrRszysf4VB");

function creatorFor(collection: PublicKey): PublicKey {
  if (collection.equals(BADGES)) return BADGES_CREATOR;
  if (collection.equals(HARMIES)) return HARMIES_CREATOR;
  throw new Error(`unknown collection: ${collection.toBase58()}`);
}

async function ensureGboyAta(owner: PublicKey): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(GBOY, owner, true);
  if (!(await retry(() => conn.getAccountInfo(ata, 'confirmed'), 'ata-check'))) {
    const { createAssociatedTokenAccountIdempotentInstruction } = await import('@solana/spl-token');
    const { sendAndConfirmTransaction, Transaction } = await import('@solana/web3.js');
    const ix = createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, GBOY);
    await retry(() => sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer]), 'create-ata');
  }
  return ata;
}

// Make the suite re-runnable: ensure `a` is owned by `want`, transferring it
// back via MPL Core if a prior run left it with the other test wallet. (We hold
// both wallet keys, so we can sign as the current owner.)
function umiFor(kp: Keypair) {
  const umi = createUmi(DEVNET, 'confirmed');
  const s = umi.eddsa.createKeypairFromSecretKey(kp.secretKey);
  umi.use(signerIdentity(createSignerFromKeypair(umi, s)));
  return umi;
}
async function ensureOwner(a: PublicKey, want: Keypair, collection: PublicKey) {
  const cur = await ownerOf(a);
  if (cur === want.publicKey.toBase58()) return;
  const owner = [A, B].find((k) => k.publicKey.toBase58() === cur);
  if (!owner) throw new Error(`cannot reset ${a.toBase58()} — owned by unknown ${cur}`);
  const umi = umiFor(owner);
  await retry(
    () =>
      transferV1(umi, {
        asset: umiPk(a.toBase58()),
        collection: umiPk(collection.toBase58()),
        newOwner: umiPk(want.publicKey.toBase58()),
      }).sendAndConfirm(umi),
    'reset-owner',
  );
}

// ---- tiny test runner -------------------------------------------------------
let pass = 0,
  fail = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    pass++;
    console.log(`✅ ${name}`);
  } catch (e: any) {
    fail++;
    console.log(`❌ ${name}\n     ${(e?.message || e).toString().split('\n').slice(0, 3).join('\n     ')}`);
  }
  await sleep(700); // be gentle on the public RPC
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ---- tests ------------------------------------------------------------------
(async () => {
  console.log(`\nneuko_market devnet tests — program ${PROGRAM_ID.toBase58()}`);
  console.log(`A=${A.publicKey.toBase58()}  B=${B.publicKey.toBase58()}\n`);

  await test('list_asset(SOL) + purchase_with_sol → asset to buyer, seller paid', async () => {
    const a = asset('H_A_sol');
    await ensureOwner(a, A, HARMIES);
    const listing = listingPda(a);
    const price = new BN(0.02 * LAMPORTS_PER_SOL);
    await retry(() =>
      program.methods
        .listAsset(price, { sol: {} })
        .accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS })
        .signers([A])
        .rpc(), 'list',
    );
    const before = await solBal(A.publicKey);
    await retry(() =>
      program.methods
        .purchaseWithSol(price)
        .accountsPartial({ buyer: B.publicKey, seller: A.publicKey, listing, asset: a, collection: HARMIES, creator: creatorFor(HARMIES), mplCoreProgram: MPL_CORE, systemProgram: SYS })
        .signers([B])
        .rpc(), 'buy-sol',
    );
    assert((await ownerOf(a)) === B.publicKey.toBase58(), 'asset should be owned by B');
    assert((await solBal(A.publicKey)) > before, 'seller SOL balance should increase');
    assert((await conn.getAccountInfo(listing)) === null, 'listing should be closed');
  });

  await test('list_asset(GBOY) + purchase_with_gboy → seller paid in $GBOY', async () => {
    const a = asset('H_A_gboy');
    await ensureOwner(a, A, HARMIES);
    const listing = listingPda(a);
    const price = gboyUnits(50);
    const buyerAta = getAssociatedTokenAddressSync(GBOY, B.publicKey);
    const sellerAta = getAssociatedTokenAddressSync(GBOY, A.publicKey);
    await retry(() =>
      program.methods
        .listAsset(price, { gboy: {} })
        .accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS })
        .signers([A])
        .rpc(), 'list-gboy',
    );
    const before = await gboyBal(sellerAta);
    const creator = creatorFor(HARMIES);
    const creatorAta = await ensureGboyAta(creator);
    await retry(() =>
      program.methods
        .purchaseWithGboy(price)
        .accountsPartial({
          buyer: B.publicKey, seller: A.publicKey, listing, gboyMint: GBOY,
          buyerGboy: buyerAta, sellerGboy: sellerAta, asset: a, collection: HARMIES,
          creator, creatorGboy: creatorAta,
          mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS,
        })
        .signers([B])
        .rpc(), 'buy-gboy',
    );
    assert((await ownerOf(a)) === B.publicKey.toBase58(), 'asset should be owned by B');
    const delta = (await gboyBal(sellerAta)) - before;
    assert(delta === BigInt(price.toString()), `seller $GBOY delta ${delta} != ${price}`);
  });

  await test('cancel_listing → asset thawed & stays with seller, listing closed', async () => {
    const a = asset('H_A_cancel');
    const listing = listingPda(a);
    // Clean up a leftover listing from a previously aborted run (also re-runnable).
    if (await retry(() => conn.getAccountInfo(listing, 'confirmed'), 'check-listing')) {
      await retry(() =>
        program.methods
          .cancelListing()
          .accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS })
          .signers([A])
          .rpc(), 'cleanup-cancel',
      );
    }
    await ensureOwner(a, A, HARMIES);
    await retry(() =>
      program.methods
        .listAsset(new BN(0.01 * LAMPORTS_PER_SOL), { sol: {} })
        .accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS })
        .signers([A])
        .rpc(), 'list-cancel',
    );
    await retry(() =>
      program.methods
        .cancelListing()
        .accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS })
        .signers([A])
        .rpc(), 'cancel',
    );
    assert((await ownerOf(a)) === A.publicKey.toBase58(), 'asset should remain with A');
    assert((await conn.getAccountInfo(listing)) === null, 'listing should be closed');
  });

  await test('create_swap + accept_swap (NFT↔NFT) → owners atomically swapped', async () => {
    const nonce = new BN(Date.now());
    const swap = swapPda(A.publicKey, nonce);
    const offered = asset('B_A_swap'); // A's badge
    const requested = asset('B_B_swap'); // B's badge
    await ensureOwner(offered, A, BADGES);
    await ensureOwner(requested, B, BADGES);
    const args = {
      offeredCount: 1, requestedAssets: [requested],
      solOffered: new BN(0), gboyOffered: new BN(0), solRequested: new BN(0), gboyRequested: new BN(0),
      taker: undefined,
    };
    await retry(() =>
      program.methods
        .createSwap(nonce, args)
        .accountsPartial({
          maker: A.publicKey, swapOffer: swap, makerGboy: undefined, swapGboy: undefined,
          mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS,
        })
        .remainingAccounts([ra(offered, true), ra(BADGES, false)])
        .signers([A])
        .rpc(), 'create-swap',
    );
    assert((await ownerOf(offered)) === swap.toBase58(), 'offered asset should be escrowed in swap PDA');
    await retry(() =>
      program.methods
        .acceptSwap()
        .accountsPartial({
          taker: B.publicKey, maker: A.publicKey, swapOffer: swap,
          takerGboy: undefined, makerGboy: undefined, swapGboy: undefined,
          mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS,
        })
        .remainingAccounts([ra(requested, true), ra(BADGES, false), ra(offered, true), ra(BADGES, false)])
        .signers([B])
        .rpc(), 'accept-swap',
    );
    assert((await ownerOf(offered)) === B.publicKey.toBase58(), "maker's badge should go to taker B");
    assert((await ownerOf(requested)) === A.publicKey.toBase58(), "taker's badge should go to maker A");
    assert((await conn.getAccountInfo(swap)) === null, 'swap should be closed');
  });

  await test('create_offer(SOL) + accept_offer → asset to bidder, seller paid from escrow', async () => {
    const nonce = new BN(Date.now());
    const offer = offerPda(B.publicKey, nonce);
    const a = asset('H_A_offer'); // owned by A
    await ensureOwner(a, A, HARMIES);
    const amount = new BN(0.02 * LAMPORTS_PER_SOL);
    await retry(() =>
      program.methods
        .createOffer(nonce, { collection: HARMIES, asset: a, amount, currency: { sol: {} } })
        .accountsPartial({ bidder: B.publicKey, offer, bidderGboy: undefined, offerGboy: undefined, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYS })
        .signers([B])
        .rpc(), 'create-offer',
    );
    const before = await solBal(A.publicKey);
    await retry(() =>
      program.methods
        .acceptOffer()
        .accountsPartial({
          seller: A.publicKey, bidder: B.publicKey, offer, asset: a, collection: HARMIES,
          creator: creatorFor(HARMIES), creatorGboy: undefined,
          offerGboy: undefined, sellerGboy: undefined, mplCoreProgram: MPL_CORE, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYS,
        })
        .signers([A])
        .rpc(), 'accept-offer',
    );
    assert((await ownerOf(a)) === B.publicKey.toBase58(), 'asset should go to bidder B');
    const gained = (await solBal(A.publicKey)) - before;
    assert(gained >= amount.toNumber() * 0.9, `seller should gain ~${amount} lamports, got ${gained}`);
    assert((await conn.getAccountInfo(offer)) === null, 'offer should be closed');
  });

  await test('list_asset rejects a non-ecosystem (foreign) collection', async () => {
    const a = asset('F_A');
    const listing = listingPda(a);
    let reverted = false;
    try {
      await program.methods
        .listAsset(new BN(0.01 * LAMPORTS_PER_SOL), { sol: {} })
        .accountsPartial({ seller: A.publicKey, listing, asset: a, collection: FOREIGN, mplCoreProgram: MPL_CORE, systemProgram: SYS })
        .signers([A])
        .rpc();
    } catch (e: any) {
      reverted = /CollectionNotAllowed|0x1770|custom program error|AnchorError/i.test(String(e?.message || e));
    }
    assert(reverted, 'foreign collection listing should be rejected by the allow-list');
  });

  console.log(`\n──────────────────────────────\n  ${pass} passed, ${fail} failed\n──────────────────────────────`);
  process.exit(fail === 0 ? 0 : 1);
})();
