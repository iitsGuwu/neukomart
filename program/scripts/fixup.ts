/**
 * One-time devnet cleanup after fixing the program:
 *   - top up the test wallets (they run low across repeated test runs)
 *   - strip leftover Freeze/Transfer delegates that the OLD (buggy) binary left
 *     on already-sold assets, so they can be listed again by the fixed program.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, signerIdentity, publicKey as umiPk } from '@metaplex-foundation/umi';
import { fetchAsset, removePlugin } from '@metaplex-foundation/mpl-core';

const DEVNET = 'https://api.devnet.solana.com';
const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'devnet-assets.json'), 'utf8'));
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'solana', 'id.json'), 'utf8'))),
);
const conn = new Connection(DEVNET, 'confirmed');
const A = Keypair.fromSecretKey(Uint8Array.from(state.wallets.A.secret));
const B = Keypair.fromSecretKey(Uint8Array.from(state.wallets.B.secret));
const HARMIES = state.collections.harmies;

function umiFor(kp: Keypair) {
  const umi = createUmi(DEVNET, 'confirmed');
  umi.use(signerIdentity(createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(kp.secretKey))));
  return umi;
}

(async () => {
  // top up to ~0.5 SOL each
  for (const kp of [A, B]) {
    const bal = await conn.getBalance(kp.publicKey);
    const target = 0.5 * LAMPORTS_PER_SOL;
    if (bal < target) {
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports: target - bal }));
      await sendAndConfirmTransaction(conn, tx, [payer]);
      console.log(`funded ${kp.publicKey.toBase58()} -> 0.5 SOL`);
    }
  }

  // strip leftover delegates from sold assets (owner = A)
  const umiA = umiFor(A);
  for (const label of ['H_A_sol', 'H_A_gboy']) {
    const id = umiPk(state.assets[label]);
    const a = await fetchAsset(umiA, id);
    if (a.owner !== A.publicKey.toBase58()) { console.log(`skip ${label}: owner ${a.owner} != A`); continue; }
    if (a.freezeDelegate) {
      await removePlugin(umiA, { asset: id, collection: umiPk(HARMIES), plugin: { type: 'FreezeDelegate' } }).sendAndConfirm(umiA);
      console.log(`${label}: removed FreezeDelegate`);
    }
    if (a.transferDelegate) {
      await removePlugin(umiA, { asset: id, collection: umiPk(HARMIES), plugin: { type: 'TransferDelegate' } }).sendAndConfirm(umiA);
      console.log(`${label}: removed TransferDelegate`);
    }
  }
  console.log('FIXUP DONE');
})().catch((e) => { console.error('FIXUP FAILED:', e); process.exit(1); });
