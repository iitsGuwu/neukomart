/**
 * Adversarial probes for the two highest-risk assumptions:
 *   A) Freeze-lock: can the OWNER escape an active listing (move/unfreeze the
 *      asset out from under the marketplace)? The escrowless model depends on NO.
 *   B) Price front-run: purchase_with_sol takes no max-price, so a seller can
 *      update_listing to a higher price right before a buyer's tx lands.
 */
import {
  program, conn, A, B, HARMIES, MPL_CORE, SYS, asset,
  BN, PublicKey, SystemProgram, listingPda, retry, ownerOf, solBal, ensureOwner,
} from '../tests/_shared';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, signerIdentity, generateSigner, publicKey as umiPk } from '@metaplex-foundation/umi';
import { create, addPlugin, removePlugin, transferV1, fetchCollection } from '@metaplex-foundation/mpl-core';

const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'devnet-assets.json'), 'utf8'));
const payerKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'solana', 'id.json'), 'utf8'))));
const umi = createUmi('https://api.devnet.solana.com', 'confirmed');
umi.use(signerIdentity(createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(payerKp.secretKey))));

async function expectFail(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); console.log(`  ⚠️  ${label}: SUCCEEDED (unexpected!)`); return false; }
  catch (e: any) { console.log(`  ✓ ${label}: blocked (${String(e?.message || e).split('\n')[0].slice(0, 70)})`); return true; }
}

async function probeFreezeLock() {
  console.log('\n=== PROBE A: can an owner escape an active listing? ===');
  const collection = await fetchCollection(umi, umiPk(state.collections.harmies));
  const a = generateSigner(umi);
  const D = generateSigner(umi); // stand-in for the listing PDA (freeze+transfer delegate)
  const stranger = generateSigner(umi);
  await create(umi, { asset: a, collection, owner: umi.identity.publicKey, name: 'LockProbe', uri: 'https://neuko.test/p.json' }).sendAndConfirm(umi);
  await addPlugin(umi, { asset: a.publicKey, collection: collection.publicKey, plugin: { type: 'TransferDelegate', authority: { type: 'Address', address: D.publicKey } } }).sendAndConfirm(umi);
  await addPlugin(umi, { asset: a.publicKey, collection: collection.publicKey, plugin: { type: 'FreezeDelegate', data: { frozen: true }, authority: { type: 'Address', address: D.publicKey } } }).sendAndConfirm(umi);
  console.log('  set up: asset frozen, delegates -> D (owner = us)');

  // The owner tries every escape route while the asset is "listed" (frozen):
  await expectFail('owner transfers the frozen asset', () =>
    transferV1(umi, { asset: a.publicKey, collection: collection.publicKey, newOwner: stranger.publicKey }).sendAndConfirm(umi));
  await expectFail('owner removes FreezeDelegate while frozen', () =>
    removePlugin(umi, { asset: a.publicKey, collection: collection.publicKey, plugin: { type: 'FreezeDelegate' } }).sendAndConfirm(umi));
  await expectFail('owner removes TransferDelegate while frozen', () =>
    removePlugin(umi, { asset: a.publicKey, collection: collection.publicKey, plugin: { type: 'TransferDelegate' } }).sendAndConfirm(umi));
}

async function probeFrontRun() {
  console.log('\n=== PROBE B: purchase price front-run (no slippage guard) ===');
  const a = asset('H_A_sol');
  await ensureOwner(a, A, HARMIES);
  const listing = listingPda(a);
  if (await retry(() => conn.getAccountInfo(listing, 'confirmed'), 'chk')) {
    await retry(() => program.methods.cancelListing().accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS }).signers([A]).rpc(), 'pre-clear');
  }
  const listed = new BN(0.01 * LAMPORTS_PER_SOL);
  const frontRun = new BN(0.08 * LAMPORTS_PER_SOL);
  await retry(() => program.methods.listAsset(listed, { sol: {} }).accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS }).signers([A]).rpc(), 'list');
  console.log(`  A lists at ${listed.toNumber() / LAMPORTS_PER_SOL} SOL (what the buyer sees)`);
  // Seller front-runs the buyer's pending purchase:
  await retry(() => program.methods.updateListing(frontRun, { sol: {} }).accountsPartial({ seller: A.publicKey, listing }).signers([A]).rpc(), 'update');
  console.log(`  A front-runs: update_listing -> ${frontRun.toNumber() / LAMPORTS_PER_SOL} SOL`);
  const before = await solBal(B.publicKey);
  await retry(() => program.methods.purchaseWithSol().accountsPartial({ buyer: B.publicKey, seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS }).signers([B]).rpc(), 'buy');
  const paid = before - (await solBal(B.publicKey));
  console.log(`  B intended to pay ${listed.toNumber() / LAMPORTS_PER_SOL} SOL but was charged ~${(paid / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  console.log(paid > listed.toNumber() * 2 ? '  ⚠️  VULNERABLE: buyer overcharged with no slippage protection' : '  ✓ buyer paid the expected amount');
}

(async () => {
  await probeFreezeLock();
  await probeFrontRun();
  console.log('\nDONE');
})().catch((e) => { console.error('INVESTIGATE FAILED:', e); process.exit(1); });
