/**
 * DEFINITIVE freeze-lock probe — uses the REAL program's list_asset to freeze an
 * asset, then verifies the owner cannot escape: cannot transfer it, cannot remove
 * the freeze. This is the load-bearing assumption of the escrowless model.
 */
import {
  program, conn, A, HARMIES, MPL_CORE, SYS, asset, listingPda, retry, ownerOf, ensureOwner, BN,
} from '../tests/_shared';
import { Keypair } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, signerIdentity, generateSigner, publicKey as umiPk } from '@metaplex-foundation/umi';
import { fetchAsset, transferV1, removePlugin, updatePlugin } from '@metaplex-foundation/mpl-core';

const DEVNET = 'https://api.devnet.solana.com';
const umiA = createUmi(DEVNET, 'confirmed');
umiA.use(signerIdentity(createSignerFromKeypair(umiA, umiA.eddsa.createKeypairFromSecretKey(A.secretKey))));

async function expectFail(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); console.log(`  ⚠️  ${label}: SUCCEEDED (escrowless model BROKEN!)`); return false; }
  catch (e: any) { console.log(`  ✓ ${label}: blocked (${String(e?.message || e).split('\n')[0].slice(0, 60)})`); return true; }
}

(async () => {
  const a = asset('H_A_cancel');
  await ensureOwner(a, A, HARMIES);
  const listing = listingPda(a);
  if (await retry(() => conn.getAccountInfo(listing, 'confirmed'), 'chk')) {
    await retry(() => program.methods.cancelListing().accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS }).signers([A]).rpc(), 'pre-clear');
  }

  console.log('listing via the real program (freezes the asset)...');
  await retry(() => program.methods.listAsset(new BN(10_000_000), { sol: {} }).accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS }).signers([A]).rpc(), 'list');

  const fetched = await fetchAsset(umiA, umiPk(a.toBase58()));
  console.log(`  freezeDelegate.frozen = ${fetched.freezeDelegate?.frozen}  (must be true)`);

  console.log('\n=== owner tries to escape the active listing ===');
  const stranger = generateSigner(umiA);
  await expectFail('owner transfers the listed asset', () =>
    transferV1(umiA, { asset: umiPk(a.toBase58()), collection: umiPk(HARMIES.toBase58()), newOwner: stranger.publicKey }).sendAndConfirm(umiA));
  await expectFail('owner thaws (updatePlugin frozen=false) — should need the delegate', () =>
    updatePlugin(umiA, { asset: umiPk(a.toBase58()), collection: umiPk(HARMIES.toBase58()), plugin: { type: 'FreezeDelegate', frozen: false } }).sendAndConfirm(umiA));
  await expectFail('owner removes FreezeDelegate while frozen', () =>
    removePlugin(umiA, { asset: umiPk(a.toBase58()), collection: umiPk(HARMIES.toBase58()), plugin: { type: 'FreezeDelegate' } }).sendAndConfirm(umiA));

  console.log('\ncleanup: cancel_listing...');
  await retry(() => program.methods.cancelListing().accountsPartial({ seller: A.publicKey, listing, asset: a, collection: HARMIES, mplCoreProgram: MPL_CORE, systemProgram: SYS }).signers([A]).rpc(), 'cancel');
  console.log(`  asset owner after cancel: ${(await ownerOf(a)) === A.publicKey.toBase58() ? 'A (correct)' : 'WRONG'}`);
  console.log('\nDONE');
})().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
