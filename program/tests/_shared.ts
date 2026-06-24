/** Shared devnet test scaffolding (program client, wallets, helpers). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, signerIdentity, publicKey as umiPk } from '@metaplex-foundation/umi';
import { transferV1 } from '@metaplex-foundation/mpl-core';

export { BN, SystemProgram, PublicKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync };
export const DEVNET = 'https://api.devnet.solana.com';
export const MPL_CORE = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
export const SYS = SystemProgram.programId;

export const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'devnet-assets.json'), 'utf8'));
const idl = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'target', 'idl', 'neuko_market.json'), 'utf8'));

export const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'solana', 'id.json'), 'utf8'))),
);
export const conn = new Connection(DEVNET, 'confirmed');
const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(payer), { commitment: 'confirmed', preflightCommitment: 'confirmed' });
anchor.setProvider(provider);
export const program = new anchor.Program(idl as anchor.Idl, provider);
export const PROGRAM_ID = new PublicKey(idl.address);

export const A = Keypair.fromSecretKey(Uint8Array.from(state.wallets.A.secret));
export const B = Keypair.fromSecretKey(Uint8Array.from(state.wallets.B.secret));
export const GBOY = new PublicKey(state.gboyMint);
export const HARMIES = new PublicKey(state.collections.harmies);
export const BADGES = new PublicKey(state.collections.badges);
export const FOREIGN = new PublicKey(state.collections.foreign);
export const asset = (k: string) => new PublicKey(state.assets[k]);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function retry<T>(fn: () => Promise<T>, label = 'op'): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < 8; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e);
      if (/custom program error|AnchorError|Error Code|Error Number|0x[0-9a-f]+ /i.test(msg) && !/429|Too Many Requests|rate/i.test(msg)) throw e;
      await sleep(Math.min(800 * 2 ** i, 8000));
    }
  }
  throw new Error(`${label} failed after retries: ${lastErr?.message || lastErr}`);
}

export async function ownerOf(a: PublicKey): Promise<string> {
  const info = await retry(() => conn.getAccountInfo(a, 'confirmed'), 'getAccountInfo');
  if (!info) throw new Error('asset account missing');
  return new PublicKey(info.data.subarray(1, 33)).toBase58();
}
export async function gboyBal(ata: PublicKey): Promise<bigint> {
  return (await retry(() => getAccount(conn, ata, 'confirmed'), 'getAccount')).amount;
}
export async function solBal(pk: PublicKey): Promise<number> {
  return retry(() => conn.getBalance(pk, 'confirmed'), 'getBalance');
}
export function listingPda(a: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from('listing'), a.toBuffer()], PROGRAM_ID)[0];
}
export function swapPda(maker: PublicKey, nonce: BN) {
  return PublicKey.findProgramAddressSync([Buffer.from('swap'), maker.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)], PROGRAM_ID)[0];
}
export function offerPda(bidder: PublicKey, nonce: BN) {
  return PublicKey.findProgramAddressSync([Buffer.from('offer'), bidder.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)], PROGRAM_ID)[0];
}
export const ra = (pk: PublicKey, w: boolean) => ({ pubkey: pk, isSigner: false, isWritable: w });
export const gboyUnits = (n: number) => new BN(n).mul(new BN(10).pow(new BN(10)));
export const ataOf = (owner: PublicKey) => getAssociatedTokenAddressSync(GBOY, owner, true);

/** Create the $GBOY ATA for a (possibly off-curve / PDA) owner if missing. */
export async function ensureGboyAta(owner: PublicKey): Promise<PublicKey> {
  const ata = ataOf(owner);
  if (!(await retry(() => conn.getAccountInfo(ata, 'confirmed'), 'ata-check'))) {
    const ix = createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, GBOY);
    await retry(() => sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer]), 'create-ata');
  }
  return ata;
}

function umiFor(kp: Keypair) {
  const umi = createUmi(DEVNET, 'confirmed');
  umi.use(signerIdentity(createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(kp.secretKey))));
  return umi;
}
/** Ensure `a` is owned by `want`, transferring back via MPL Core if needed. */
export async function ensureOwner(a: PublicKey, want: Keypair, collection: PublicKey) {
  const cur = await ownerOf(a);
  if (cur === want.publicKey.toBase58()) return;
  const owner = [A, B].find((k) => k.publicKey.toBase58() === cur);
  if (!owner) throw new Error(`cannot reset ${a.toBase58()} — owned by unknown ${cur}`);
  const umi = umiFor(owner);
  await retry(
    () => transferV1(umi, { asset: umiPk(a.toBase58()), collection: umiPk(collection.toBase58()), newOwner: umiPk(want.publicKey.toBase58()) }).sendAndConfirm(umi),
    'reset-owner',
  );
}

/** Minimal test runner with pass/fail tally. */
export function createRunner(title: string) {
  let pass = 0,
    fail = 0;
  console.log(`\n${title} — program ${PROGRAM_ID.toBase58()}`);
  console.log(`A=${A.publicKey.toBase58()}  B=${B.publicKey.toBase58()}\n`);
  const test = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      pass++;
      console.log(`✅ ${name}`);
    } catch (e: any) {
      fail++;
      console.log(`❌ ${name}\n     ${(e?.message || e).toString().split('\n').slice(0, 3).join('\n     ')}`);
    }
    await sleep(700);
  };
  const finish = () => {
    console.log(`\n──────────────────────────────\n  ${pass} passed, ${fail} failed\n──────────────────────────────`);
    process.exit(fail === 0 ? 0 : 1);
  };
  return { test, finish };
}

export function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
/** Assert that `fn` reverts, and that the error text matches `re`. Routed through
 *  `retry` so transient 429s are retried while program reverts surface at once. */
export async function expectRevert(fn: () => Promise<unknown>, re: RegExp, label: string) {
  try {
    await retry(fn, label);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (re.test(msg)) return;
    throw new Error(`${label}: reverted but with unexpected error: ${msg.split('\n')[0].slice(0, 160)}`);
  }
  throw new Error(`${label}: expected a revert but the tx succeeded`);
}
